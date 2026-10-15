/**
 * The desktop band's own layout: what the Claude Code mod (hooks/register.tsx) draws above the prompt.
 *
 * Kept apart from the terminal's `lines` because the two surfaces differ: the desktop app already shows
 * the model, the context ring and the project, and a mod cannot import Node modules, so only a few
 * widgets can run there. This file is pure (no I/O) so the mod, the config loader and the web panel can
 * all import it; the mod's sandbox cannot load anything that touches `node:*`.
 */
import type { LineConfig, WidgetInstance } from "./types.js";

/**
 * The widgets the mod can draw, by registry id. Anything else in a desktop layout is dropped when it is
 * read, and the panel greys it out in the tray: it would need files, git or the statusline payload,
 * none of which a mod can reach.
 */
export const DESKTOP_WIDGETS = ["usage.windows", "usage.single", "cost.session", "context.promptCache", "tokens.session", "tokens.outputSpeed"] as const;

export type DesktopWidgetId = (typeof DESKTOP_WIDGETS)[number];

export function isDesktopWidget(id: string): id is DesktopWidgetId {
  return (DESKTOP_WIDGETS as readonly string[]).includes(id);
}

/**
 * What the band shows until the user designs their own: one row, as little of the prompt area as it can
 * take. Short bars without reset times or a "Usage" label on the left; the cache hit ratio, output speed
 * and cost on the right. Session tokens are one click away in the panel's tray.
 */
export const DEFAULT_DESKTOP_LINES: LineConfig[] = [
  {
    left: [{ widget: "usage.windows", label: null, options: { bar: true, barWidth: 6, showReset: false } }],
    right: [{ widget: "context.promptCache", label: "Cache", options: { showHitRatio: true } }, { widget: "tokens.outputSpeed" }, { widget: "cost.session" }],
  },
];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function cleanZone(zone: unknown): WidgetInstance[] {
  if (!Array.isArray(zone)) return [];
  return zone.filter((w): w is WidgetInstance => isObject(w) && typeof w.widget === "string" && isDesktopWidget(w.widget));
}

/**
 * The desktop lines out of a parsed config file (`desktop.lines`), or the defaults when the file has none.
 * A file can say `lines: []` on purpose (an empty band), so only a missing or malformed value falls back.
 * Widgets the mod cannot draw are dropped, and a line that ends up empty is kept as written.
 */
export function readDesktopLines(config: unknown): LineConfig[] {
  const lines = isObject(config) && isObject(config.desktop) ? config.desktop.lines : undefined;
  if (!Array.isArray(lines)) return DEFAULT_DESKTOP_LINES;
  return lines.filter(isObject).map((l) => ({ left: cleanZone(l.left), right: cleanZone(l.right) }));
}
