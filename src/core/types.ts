/**
 * Core contracts shared by the render engine, the widget registry, the CLI and the web server.
 * Everything here is plain data — no I/O.
 */
import type { RenderContext as DataContext, SessionTokenUsage } from "../data/types.js";
import type { ResponseSpeed } from "./response-speed.js";
import type { RepoRef } from "./git-remote.js";
import type { ResetBaseline } from "./reset.js";

/** Theme token or literal color ("#rrggbb", "208", "red", "brightBlue"). */
export type Color = string;

export interface Style {
  fg?: Color;
  bg?: Color;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface Segment {
  text: string;
  style?: Style;
  /** OSC 8 hyperlink target. */
  link?: string;
}

export type Zone = "left" | "center" | "right";

export type OverflowPolicy = "wrap" | "truncate" | "drop-right";

export interface WidgetInstance {
  /** Registry id, e.g. "context.bar". */
  widget: string;
  /** Widget-specific options validated against the widget's JSON schema. */
  options?: Record<string, unknown>;
  /** Style override applied on top of whatever the widget emits. */
  style?: Style;
  /** Optional label to prefix (widgets decide whether they honour it). */
  label?: string | null;
  /**
   * What this widget prints while it has no data, after its label: overrides the config-wide
   * `emptyText`. Unlike the global one it shows even without a label, since the user asked for it
   * on this widget. "" or null hides the widget when empty, whatever the global setting.
   */
  emptyText?: string | null;
}

export interface LineConfig {
  left?: WidgetInstance[];
  center?: WidgetInstance[];
  right?: WidgetInstance[];
  /** Overrides the global separator for this line. */
  separator?: string;
  overflow?: OverflowPolicy;
  /** Hide the whole line when the terminal is narrower than this. */
  minColumns?: number;
}

export type ColorLevel = "auto" | "truecolor" | "256" | "16" | "none";

/**
 * How percentage widgets (bars and their numbers) are coloured — the panel's "Progress bar mode".
 * `thresholds`: the widget's ok token below warnAt, then warn, then crit from critAt. `gradient`: a
 * continuous hex from the percentage alone (`gradient()` in api.ts). It is one config-wide setting;
 * up to 0.4.1 each widget had its own, which liftLegacyColorMode (config.ts) still reads.
 */
export type ColorMode = "thresholds" | "gradient";

export interface ThemeTokens {
  fg: Color;
  muted: Color;
  accent: Color;
  ok: Color;
  warn: Color;
  crit: Color;
  model: Color;
  project: Color;
  git: Color;
  usage: Color;
  context: Color;
  [token: string]: Color;
}

export interface ThemeDef {
  name: string;
  tokens: ThemeTokens;
  /** Glyphs used by bar widgets. */
  bar?: { filled: string; empty: string };
}

export interface GitConfig {
  enabled: boolean;
  /** Milliseconds a cached git status stays valid when .git/HEAD and .git/index are unchanged. */
  cacheMs: number;
}

/**
 * Widget plugins are code: loading one runs it with the user's privileges on every statusline tick.
 * So only the user decides where plugins come from — this whole block is read from the user config
 * layer, never from a project's `.claude/claude-code-super-statusline.json` (see loadEffectiveConfig).
 */
export interface PluginsConfig {
  /** Extra directories scanned for widget modules. */
  dirs: string[];
  /**
   * Projects whose own `.claude/claude-code-super-statusline/widgets/` may load. A repo you just cloned is not in
   * here, so opening it in Claude Code can't make the statusline run its code. Absolute paths; a
   * project counts as trusted when its directory is one of these or inside one.
   */
  trustedProjects: string[];
}

/** The layout the Claude Code mod draws in the desktop app. Only the widgets in DESKTOP_WIDGETS can run there. */
export interface DesktopConfig {
  lines: LineConfig[];
}

export interface FooterConfig {
  $schema?: string;
  /** 1 or 2; files still at 1 are migrated as they are read (config.ts migrateGitBranchParts). */
  version: 1 | 2;
  theme: string | ThemeDef;
  colorLevel: ColorLevel;
  separator: string;
  /** Overrides the theme's bar glyphs, e.g. { filled: "▮", empty: "▯" }. */
  bar?: { filled: string; empty: string };
  /** How every percentage widget is coloured; see ColorMode. */
  colorMode: ColorMode;
  /** Cells subtracted from $COLUMNS to leave room for Claude Code's own footer padding. */
  columnsOffset: number;
  /**
   * What a labelled widget prints while it has no data, e.g. "–" → "Name –". "" (the default) hides
   * empty widgets as before. Widgets without a label stay hidden: a bare "–" would not say what is
   * missing. A widget's own `emptyText` overrides this.
   */
  emptyText: string;
  lines: LineConfig[];
  /** The desktop app's band above the prompt, drawn by the mod (src/core/desktop.ts); separate from `lines`. */
  desktop: DesktopConfig;
  git: GitConfig;
  plugins: PluginsConfig;
  /** Persist the last stdin payload per session for the web preview. */
  captureSamples: boolean;
}

/** What widgets see. Read-only view over the harvested data context plus render-time facts. */
export interface Ctx extends DataContext {
  columns: number;
  now: number;
  theme: ThemeDef;
  /** The config's colour mode, which `api.levelColor` follows. */
  colorMode: ColorMode;
  /** Counter baseline recorded by `reset` (CLI or the panel) for this session, if any. */
  reset: ResetBaseline | null;
  /** Output speed of the latest long-enough response, from the transcript tail (see response-speed.ts). */
  responseSpeed?: ResponseSpeed | null;
  /**
   * Cumulative usage of the session's subagents, read from their own transcript files (subagents.ts);
   * null when there are none. Kept apart from `transcript.sessionTokens` on purpose: that one also
   * prices the cost estimate at the main model's rates, and subagents often run a different model.
   */
  subagentTokens?: SessionTokenUsage | null;
  /** `origin` from .git/config, filled only when Claude Code didn't send workspace.repo (git-remote.ts). */
  originRepo?: RepoRef | null;
}

export interface WidgetApi {
  /** ok | warn | crit for a 0–100 value. */
  level(pct: number, warnAt?: number, critAt?: number): "ok" | "warn" | "crit";
  /** Progress bar using the theme's glyphs. */
  bar(pct: number, width?: number): string;
  /** Hex colour for a 0–100 value on a continuous spectrum: white → blue → green → yellow → orange → red → deep red. */
  gradient(pct: number): string;
  /**
   * The colour for a 0–100 value under the user's colour mode: `gradient(pct)` in gradient mode,
   * else `okToken` / "warn" / "crit" by `lvl` (from `level()`). A plugin that draws a percentage
   * should use this, so it follows the panel's "Progress bar mode" like the built-ins do.
   */
  levelColor(pct: number, lvl: "ok" | "warn" | "crit", okToken: Color): Color;
  /** 12345 → "12k", 1_234_567 → "1.2M". */
  tokens(n: number): string;
  /** Milliseconds → "3h 41m". */
  duration(ms: number): string;
  /** Unix seconds/ms or Date → relative "in 3h 41m" / "26m ago". */
  relative(when: number | Date, now?: number): string;
  seg(text: string, style?: Style): Segment;
}

export interface JsonSchema {
  type?: string | string[];
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  required?: string[];
  /**
   * Option dependency: this option only affects the output while every listed sibling option has
   * the given value (e.g. cacheGlyph needs `{ style: "arrows" }`). The panel dims the option and
   * says what it needs; the option sweep test only exercises it with the requirement met.
   */
  "x-requires"?: Record<string, unknown>;
  /**
   * Like x-requires, but on top-level config keys instead of sibling options: warnAt needs
   * `{ colorMode: "thresholds" }`, since the gradient ignores it. The panel dims it the same way.
   */
  "x-requires-config"?: Record<string, unknown>;
  [k: string]: unknown;
}

export type WidgetCategory =
  | "model"
  | "project"
  | "git"
  | "context"
  | "usage"
  | "cost"
  | "session"
  | "activity"
  | "environment"
  | "misc";

export interface WidgetDefinition<O extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  name: string;
  description: string;
  category: WidgetCategory;
  schema: JsonSchema;
  defaults: O;
  /** Example output shown in the picker. */
  sample?: string;
  /**
   * The stand-in the preview prints when this instance has no data, for widgets whose options
   * change what they show (Changes with only ↑N ↓N shouldn't stand in as "+156 -23 · 4 files").
   * Falls back to `sample`.
   */
  sampleFor?(opts: O): string;
  render(ctx: Ctx, opts: O, api: WidgetApi): Segment[] | string | null;
  /** Optional numeric value (0–100 or raw) for generic threshold coloring. */
  numeric?(ctx: Ctx, opts: O): number | null;
}

export interface RegisteredWidget extends WidgetDefinition {
  source: "builtin" | "plugin";
  sourcePath?: string;
}

/** Serializable manifest sent to the web UI. */
export interface WidgetManifest {
  id: string;
  name: string;
  description: string;
  category: WidgetCategory;
  schema: JsonSchema;
  defaults: Record<string, unknown>;
  sample?: string;
  source: "builtin" | "plugin";
  sourcePath?: string;
}

export interface RenderedLine {
  text: string;
  /** Visual width of the line after layout, for diagnostics. */
  width: number;
}

export interface RenderOptions {
  /** Preview only: when a widget has no data, print its sample text instead of dropping it. */
  fillEmpty?: boolean;
}

export interface RenderResult {
  lines: string[];
  /** Per-widget errors swallowed during render (plugin failures etc.). */
  errors: Array<{ widget: string; message: string }>;
  /**
   * Widgets that had no data for this payload. `filled`: the preview's sample text stood in for it;
   * `placeholder`: the configured emptyText did (and Claude Code shows the same).
   */
  empty: Array<{ line: number; zone: Zone; index: number; widget: string; filled?: boolean; placeholder?: boolean }>;
  ms: number;
}

export function defineWidget<O extends Record<string, unknown>>(def: WidgetDefinition<O>): WidgetDefinition<O> {
  return def;
}
