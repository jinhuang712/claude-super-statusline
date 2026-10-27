import { defineWidget } from "../core/types.js";
import { labelSchema, stdin, thresholdSchema, withLabel } from "./_shared.js";

type Window = { key: "5h" | "7d" | "spend"; pct: number | null; resetsAt: number | null };

/*
  Claude Code drops a window from stdin right after it resets, until new usage lands. The 5h and 7d
  windows are always listed once rate_limits exists at all, with pct null meaning "no figure yet",
  so the line keeps its shape instead of a segment blinking out. spend_limit only exists on some plans.
*/
function windows(ctx: Parameters<typeof stdin>[0]): Window[] {
  const rl = stdin(ctx).rate_limits;
  if (!rl) return [];
  const out: Window[] = [
    { key: "5h", pct: rl.five_hour?.used_percentage ?? null, resetsAt: rl.five_hour?.resets_at ?? null },
    { key: "7d", pct: rl.seven_day?.used_percentage ?? null, resetsAt: rl.seven_day?.resets_at ?? null },
  ];
  if (rl.spend_limit) out.push({ key: "spend", pct: rl.spend_limit.used_percentage ?? null, resetsAt: rl.spend_limit.resets_at ?? null });
  return out;
}

/** "14:40" while the reset is today, "9/6 10:00" once it lands on another day (7-day windows usually do). */
function absoluteReset(when: number, now: number): string {
  const d = new Date(when);
  const n = new Date(now);
  const two = (x: number) => String(x).padStart(2, "0");
  const hm = `${two(d.getHours())}:${two(d.getMinutes())}`;
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return sameDay ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

const WEEK_MS = 7 * 24 * 3600 * 1000;

/**
 * How much of the 7-day budget an even spend would have used by now: the elapsed share of the window
 * as a percentage (100/7 = 14.3% per day). Claude Code only reports the reset time, so the window
 * start is derived from it. Clamped, because a stale reset (already past) or clock skew must not
 * print a pace outside 0-100%.
 */
export function weekPace(resetsAtMs: number, now: number): number {
  const elapsed = WEEK_MS - (resetsAtMs - now);
  return Math.min(100, Math.max(0, (elapsed / WEEK_MS) * 100));
}

export const usageWindows = defineWidget<{
  label: string | null;
  show5h: boolean;
  show7d: boolean;
  showSpend: boolean;
  bar: boolean;
  barWidth: number;
  showReset: boolean;
  resetFormat: "relative" | "absolute";
  showPace: boolean;
  value: "used" | "remaining";
  warnAt: number;
  critAt: number;
}>({
  id: "usage.windows",
  name: "Rate-limit windows",
  description: "5-hour / 7-day / spend-limit usage from Claude Code (Pro/Max).",
  category: "usage",
  sample: "Usage 5h ██░░░░░░░░ 23% (3h 41m) │ 7d ████░░░░░░ 41% (5d 2h)",
  schema: {
    type: "object",
    properties: {
      label: { ...labelSchema, default: "Usage" },
      show5h: { type: "boolean", default: true, title: "Show 5-hour window" },
      show7d: { type: "boolean", default: true, title: "Show 7-day window" },
      showSpend: { type: "boolean", default: true, title: "Show spend limit (if present)" },
      bar: { type: "boolean", default: false, title: "Progress bars" },
      barWidth: { type: "integer", default: 8, minimum: 3, maximum: 30, title: "Bar width", "x-requires": { bar: true } },
      showReset: { type: "boolean", default: true, title: "Show reset time" },
      resetFormat: { type: "string", enum: ["relative", "absolute"], default: "relative", title: "Reset time format", "x-requires": { showReset: true } },
      showPace: { type: "boolean", default: false, title: "Show 7-day pace (share used by now if spread evenly)" },
      value: { type: "string", enum: ["used", "remaining"], default: "used", title: "Value" },
      ...thresholdSchema(70, 90),
    },
  },
  defaults: {
    label: "Usage",
    show5h: true,
    show7d: true,
    showSpend: true,
    bar: false,
    barWidth: 8,
    showReset: true,
    resetFormat: "relative",
    showPace: false,
    value: "used",
    warnAt: 70,
    critAt: 90,
  },
  numeric: (ctx) => {
    const ws = windows(ctx).map((w) => w.pct ?? 0);
    return ws.length ? Math.max(...ws) : null;
  },
  render(ctx, o, api) {
    const ws = windows(ctx).filter((w) => (w.key === "5h" && o.show5h) || (w.key === "7d" && o.show7d) || (w.key === "spend" && o.showSpend));
    if (!ws.length) return null;
    const segs = [];
    const label = withLabel(o.label, "Usage");
    if (label) segs.push(api.seg(`${label} `, { fg: "muted" }));
    ws.forEach((w, i) => {
      if (i > 0) segs.push(api.seg(" │ ", { fg: "muted" }));
      if (w.pct === null) {
        // Window not reported yet (just reset): keep the slot, show a dash in place of the figure.
        segs.push(api.seg(`${w.key} `, { fg: "muted" }));
        if (o.bar) segs.push(api.seg(api.bar(0, o.barWidth) + " ", { fg: "muted" }));
        segs.push(api.seg("—", { fg: "muted" }));
        return;
      }
      const pct = w.pct;
      const lvl = api.level(pct, o.warnAt, o.critAt);
      const shown = o.value === "remaining" ? Math.max(0, 100 - Math.round(pct)) : Math.round(pct);
      segs.push(api.seg(`${w.key} `, { fg: "muted" }));
      const resetTxt = w.resetsAt ? (o.resetFormat === "absolute" ? absoluteReset(w.resetsAt * 1000, ctx.now) : api.duration(Math.max(0, w.resetsAt * 1000 - ctx.now))) : null;
      if (pct >= 100 && resetTxt) {
        // A full bar says nothing new; the only useful fact now is when the window opens again.
        segs.push(api.seg(o.resetFormat === "absolute" ? `resets ${resetTxt}` : `resets in ${resetTxt}`, { fg: "crit", bold: true }));
        return;
      }
      if (o.bar) segs.push(api.seg(api.bar(pct, o.barWidth) + " ", { fg: api.levelColor(pct, lvl, "usage") }));
      segs.push(api.seg(`${shown}%`, { fg: api.levelColor(pct, lvl, "fg"), bold: lvl === "crit" }));
      if (o.showPace && w.key === "7d" && w.resetsAt) {
        // Above the even-spend line the week's allowance runs out early at this rate: warn, else stay quiet.
        const pace = weekPace(w.resetsAt * 1000, ctx.now);
        segs.push(api.seg(` pace ${Math.round(pace)}%`, { fg: pct > pace ? "warn" : "muted" }));
      }
      if (o.showReset && resetTxt) segs.push(api.seg(` (${resetTxt})`, { fg: "muted" }));
    });
    return segs;
  },
});

export const usageSingle = defineWidget<{ window: "5h" | "7d"; label: string | null; bar: boolean; barWidth: number; showReset: boolean; resetFormat: "relative" | "absolute"; warnAt: number; critAt: number }>({
  id: "usage.single",
  name: "Single rate-limit window",
  description: "Just one window as compact text, e.g. for a narrow zone.",
  category: "usage",
  sample: "5h 23%",
  schema: {
    type: "object",
    properties: {
      window: { type: "string", enum: ["5h", "7d"], default: "5h" },
      label: { ...labelSchema, default: null },
      bar: { type: "boolean", default: false, title: "Show bar" },
      barWidth: { type: "integer", default: 8, minimum: 3, maximum: 40, title: "Bar width", "x-requires": { bar: true } },
      showReset: { type: "boolean", default: false, title: "Show reset time" },
      resetFormat: { type: "string", enum: ["relative", "absolute"], default: "relative", title: "Reset time format", "x-requires": { showReset: true } },
      ...thresholdSchema(70, 90),
    },
  },
  defaults: { window: "5h", label: null, bar: false, barWidth: 8, showReset: false, resetFormat: "relative", warnAt: 70, critAt: 90 },
  render(ctx, o, api) {
    const w = windows(ctx).find((x) => x.key === o.window);
    if (!w) return null;
    const label = withLabel(o.label, o.window);
    if (w.pct === null) {
      return [...(label ? [api.seg(`${label} `, { fg: "muted" })] : []), ...(o.bar ? [api.seg(api.bar(0, o.barWidth) + " ", { fg: "muted" })] : []), api.seg("—", { fg: "muted" })];
    }
    const pct = Math.round(w.pct);
    const lvl = api.level(pct, o.warnAt, o.critAt);
    const segs = label ? [api.seg(`${label} `, { fg: "muted" })] : [];
    const resetTxt = w.resetsAt ? (o.resetFormat === "absolute" ? absoluteReset(w.resetsAt * 1000, ctx.now) : api.duration(Math.max(0, w.resetsAt * 1000 - ctx.now))) : null;
    if (pct >= 100 && resetTxt) {
      segs.push(api.seg(o.resetFormat === "absolute" ? `resets ${resetTxt}` : `resets in ${resetTxt}`, { fg: "crit", bold: true }));
      return segs;
    }
    if (o.bar) segs.push(api.seg(api.bar(pct, o.barWidth) + " ", { fg: api.levelColor(pct, lvl, "usage") }));
    segs.push(api.seg(`${pct}%`, { fg: api.levelColor(pct, lvl, "fg"), bold: lvl === "crit" }));
    if (o.showReset && resetTxt) segs.push(api.seg(` (${resetTxt})`, { fg: "muted" }));
    return segs;
  },
});
