/**
 * The welcome page's three presets (web/src/store.ts PRESETS), rendered by the real engine on the
 * demo session and printed to stdout as HTML. site/build.ts runs this in its own process with
 * HOME=/Users/you: the widgets resolve `~/…` against os.homedir(), which Bun fixes at startup, so
 * the demo's home has to be there from the start.
 *
 *   HOME=/Users/you bun site/presets.ts <demo-context.json> <columns>
 */
import * as fs from "node:fs";
import { normalizeConfig } from "../src/core/config.ts";
import { render } from "../src/core/layout.ts";
import type { Ctx } from "../src/core/types.ts";
import { registerBuiltinWidgets } from "../src/widgets/index.ts";
import { en } from "../web/src/i18n/en.ts";
import { zh } from "../web/src/i18n/zh.ts";
import { PRESETS } from "../web/src/store.ts";

const [file, colsArg] = process.argv.slice(2);
const columns = Number(colsArg);
if (!file || !Number.isFinite(columns)) throw new Error("usage: bun site/presets.ts <demo-context.json> <columns>");

/** JSON can't carry Dates: site/build.ts wrote them as { $date: iso } (site/demo/api.ts does the same). */
function revive(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(revive);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.$date === "string" && Object.keys(o).length === 1) return new Date(o.$date);
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, revive(x)]));
  }
  return v;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** xterm's 256-colour cube and grey ramp, for `38;5;n` (the 16 base colours are CSS variables). */
function color256(n: number): string {
  if (n < 16) return `var(--ansi-${n})`;
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return `rgb(${v},${v},${v})`;
  }
  const i = n - 16;
  const step = (c: number) => (c === 0 ? 0 : 55 + c * 40);
  return `rgb(${step(Math.floor(i / 36))},${step(Math.floor(i / 6) % 6)},${step(i % 6)})`;
}

/**
 * One rendered statusline row (ANSI) as HTML spans. Covers what src/core/ansi.ts emits: SGR reset /
 * bold / dim / italic / underline, 16, 256 and 24-bit colours, and OSC 8 links, which are dropped
 * (text kept). Base colours are CSS variables, so site.css gives each scheme the configurator
 * preview's own terminal palette (web/src/theme.ts PALETTES).
 */
function ansiToHtml(line: string): string {
  let out = "";
  let style: { fg?: string; bg?: string; bold?: boolean; dim?: boolean; italic?: boolean; underline?: boolean } = {};
  // SGR sequences, and OSC 8 hyperlinks with either terminator (BEL or ST).
  // eslint-disable-next-line no-control-regex
  const re = /\x1b\[([0-9;]*)m|\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g;
  let last = 0;
  const text = (t: string) => {
    if (!t) return;
    const css = [
      style.fg && `color:${style.fg}`,
      style.bg && `background:${style.bg}`,
      style.bold && "font-weight:700",
      style.dim && "opacity:.6",
      style.italic && "font-style:italic",
      style.underline && "text-decoration:underline",
    ].filter(Boolean);
    out += css.length ? `<span style="${css.join(";")}">${escapeHtml(t)}</span>` : escapeHtml(t);
  };
  for (const m of line.matchAll(re)) {
    text(line.slice(last, m.index));
    last = m.index! + m[0].length;
    if (m[1] === undefined) continue; // OSC 8
    const codes = (m[1] || "0").split(";").map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i]!;
      if (c === 0) style = {};
      else if (c === 1) style.bold = true;
      else if (c === 2) style.dim = true;
      else if (c === 3) style.italic = true;
      else if (c === 4) style.underline = true;
      else if (c === 22) style.bold = style.dim = false;
      else if (c === 23) style.italic = false;
      else if (c === 24) style.underline = false;
      else if (c === 39) style.fg = undefined;
      else if (c === 49) style.bg = undefined;
      else if (c >= 30 && c <= 37) style.fg = `var(--ansi-${c - 30})`;
      else if (c >= 90 && c <= 97) style.fg = `var(--ansi-${c - 90 + 8})`;
      else if (c >= 40 && c <= 47) style.bg = `var(--ansi-${c - 40})`;
      else if (c === 38 || c === 48) {
        const key = c === 38 ? "fg" : "bg";
        if (codes[i + 1] === 5) {
          style[key] = color256(codes[i + 2]!);
          i += 2;
        } else if (codes[i + 1] === 2) {
          style[key] = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`;
          i += 4;
        }
      }
    }
  }
  text(line.slice(last));
  return out;
}

/** Each preset's dot: the tray's category colour of what it adds (project, git, context). */
const DOT = { minimal: "#e0af68", standard: "#bb9af7", full: "#9ece6a" } as const;

/**
 * The model each preset is shown with: one family each (Sonnet → Opus → Fable), so the hero also
 * shows the model badge following whatever the session runs. Only the stdin model changes; the
 * rest of the sample session is the same for all three.
 */
const MODEL = {
  minimal: { id: "claude-sonnet-5", display_name: "Sonnet 5" },
  standard: { id: "claude-opus-5-5", display_name: "Opus 5.5" },
  full: { id: "claude-fable-5-1", display_name: "Fable 5.1" },
} as const;

registerBuiltinWidgets();
const ctx = (revive(JSON.parse(fs.readFileSync(file, "utf8"))) as { ctx: Omit<Ctx, "theme" | "colorMode"> }).ctx;
const groups = (["minimal", "standard", "full"] as const).map((id) => {
  const config = normalizeConfig({ lines: PRESETS[id].lines, colorLevel: "truecolor" });
  const r = render(config, { ...ctx, columns, stdin: { ...ctx.stdin, model: MODEL[id] } }, { fillEmpty: false });
  if (r.errors.length) throw new Error(`preset ${id}: ${r.errors.map((e) => e.message).join("; ")}`);
  // Name, line count and blurb are the configurator's own preset copy, so page and app never
  // disagree. The blurb reads "Two lines: adds usage limits"; the label keeps what follows
  // the colon, since the line count is already there.
  // The Chinese label rides along in data-zh; site/landing.ts swaps it in when the page is in 中文.
  const label = (m: typeof en) => {
    const preset = m.presets[id];
    // "Two lines: adds usage limits" / "两行：加上用量上限": the label keeps what follows the colon.
    const adds = preset.blurb.split(/: |：/).slice(1).join(": ") || preset.blurb;
    return `<b>${escapeHtml(preset.name)}</b> · ${escapeHtml(m.presets.lines(r.lines.length))} · ${escapeHtml(adds)}`;
  };
  const rows = r.lines.map((l) => `<span class="lp-row">${ansiToHtml(l)}</span>`).join("\n");
  return `<div class="lp-preset">
  <div class="lp-preset-label"><i style="background: ${DOT[id]}"></i><span data-zh="${escapeHtml(label(zh))}">${label(en)}</span><i class="lp-rule"></i></div>
  <pre class="lp-rows">${rows}</pre>
</div>`;
});
// One terminal, all three presets (hero option B): each group is a labelled render at `columns`.
process.stdout.write(`<div class="lp-term" role="img" aria-label="The three presets rendered on a sample session: Minimal on one line, Standard on two, Full on four" data-i18n-aria="term.aria">
<div class="lp-term-bar" aria-hidden="true"><span data-i18n="term.bar">three presets · one session</span><span class="lp-desk">~/dev/claude-super-statusline — claude</span><span class="lp-phone" data-i18n="term.swipe">swipe →</span></div>
<div class="lp-term-body">
${groups.join("\n")}
</div>
</div>
`);
