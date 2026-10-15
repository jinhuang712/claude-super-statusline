// Types mirrored from src/core/types.ts (kept small on purpose).
export interface Style {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
}
export interface WidgetInstance {
  widget: string;
  options?: Record<string, unknown>;
  style?: Style;
  label?: string | null;
  /** Placeholder while the widget has no data; overrides FooterConfig.emptyText. null / "" = hide. */
  emptyText?: string | null;
}
export type Zone = "left" | "center" | "right";
export interface LineConfig {
  left?: WidgetInstance[];
  center?: WidgetInstance[];
  right?: WidgetInstance[];
  separator?: string;
  overflow?: "wrap" | "truncate" | "drop-right";
  minColumns?: number;
}
export interface ThemeDef {
  name: string;
  tokens: Record<string, string>;
  bar?: { filled: string; empty: string };
}
export interface FooterConfig {
  version: 1 | 2;
  theme: string | ThemeDef;
  colorLevel: "auto" | "truecolor" | "256" | "16" | "none";
  separator: string;
  bar?: { filled: string; empty: string };
  /** How every percentage widget is coloured (Style → Progress bar mode). */
  colorMode: "thresholds" | "gradient";
  columnsOffset: number;
  /** What a labelled widget with no data prints ("Name –"); "" hides it (Style → Empty widgets). */
  emptyText?: string;
  lines: LineConfig[];
  /** The desktop app's band, drawn by the mod: its own lines, apart from the terminal's. */
  desktop: { lines: LineConfig[] };
  git: { enabled: boolean; cacheMs: number };
  /** `trustedProjects` is honoured only in the user file (a project can't trust itself). */
  plugins: { dirs: string[]; trustedProjects?: string[] };
  captureSamples: boolean;
}
export interface JsonSchema {
  type?: string | string[];
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  minimum?: number;
  maximum?: number;
  [k: string]: unknown;
}
export interface WidgetManifest {
  id: string;
  name: string;
  description: string;
  category: string;
  schema: JsonSchema;
  defaults: Record<string, unknown>;
  sample?: string;
  source: "builtin" | "plugin";
  sourcePath?: string;
  /** The mod can draw it, so the desktop layout may hold it. */
  desktop: boolean;
}
export interface SampleMeta {
  id: string;
  label: string;
  capturedAt: number | null;
  source: "live" | "fixture";
  /** Live samples only: which Claude Code session and project the snapshot came from. */
  sessionId?: string | null;
  cwd?: string | null;
  project?: string | null;
  model?: string | null;
}
export interface ConfigLayer {
  name: "defaults" | "user" | "project";
  path: string | null;
  exists: boolean;
  value: Partial<FooterConfig> | null;
  error?: string;
}
export interface EffectiveConfig {
  config: FooterConfig;
  layers: ConfigLayer[];
  paths: { user: string; project: string; samples?: string; dataDir?: string };
}
export interface RenderResult {
  lines: string[];
  errors: Array<{ widget: string; message: string }>;
  /** `filled`: the sample stood in; `placeholder`: the configured emptyText did. */
  empty: Array<{ line: number; zone: Zone; index: number; widget: string; filled?: boolean; placeholder?: boolean }>;
  ms: number;
}

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export interface DoctorReport {
  layers: Array<{ name: string; path: string | null; exists: boolean; error: string | null }>;
  plugins: {
    dirs: string[];
    loaded: Array<{ file: string; ids: string[] }>;
    errors: Array<{ file: string; message: string }>;
    /** Widget folders that exist but were not loaded (e.g. an untrusted project's widgets). */
    skipped?: Array<{ dir: string; reason: string }>;
  };
  settings: { path: string; statusLine: unknown; error: string | null };
  lastPayload: { id: string; capturedAt: number | null; payload: unknown } | null;
}

/** What `/api/install` would change; `current` is whatever settings.json has now. */
export interface InstallPlan {
  settingsFile: string;
  planned: Record<string, unknown>;
  current: unknown;
  currentIsOurs: boolean;
  /** A foreign statusLine parked by an earlier install; uninstall restores it. */
  savedPrevious: unknown;
}

/** The server refused to replace someone else's statusLine without an explicit yes (HTTP 409). */
export class NeedsConfirm extends Error {
  readonly current: unknown;
  constructor(current: unknown) {
    super("needs-confirm");
    this.current = current;
  }
}

export interface Health {
  ok: boolean;
  root: string;
  sandbox?: boolean;
  /** The GitHub Pages demo (site/): an in-browser stand-in for this API, with nothing behind it. */
  demo?: boolean;
}

const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  doctor: (cwd?: string | null) => fetch(`/api/doctor${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`).then(j<DoctorReport>),
  config: (cwd?: string | null) => fetch(`/api/config${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`).then(j<EffectiveConfig>),
  /** `cwd` picks which project the "project" scope means (the server only accepts known session dirs). */
  saveConfig: (config: Partial<FooterConfig>, scope: "user" | "project", cwd?: string | null) =>
    fetch(`/api/config${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ config, scope }) }).then(j<{ ok: true; path: string }>),
  widgets: () => fetch("/api/widgets").then(j<WidgetManifest[]>),
  themes: () => fetch("/api/themes").then(j<ThemeDef[]>),
  samples: () => fetch("/api/samples").then(j<SampleMeta[]>),
  render: (config: FooterConfig, sampleId: string | null, columns: number, fillEmpty = true) => post("/api/render", { config, sampleId, columns, fillEmpty }).then(j<RenderResult>),
  /** Many previews in one round trip (1..100 configs), same order as given. */
  renderBatch: (configs: FooterConfig[], sampleId: string | null, columns: number, fillEmpty = true) =>
    post("/api/render/batch", { configs, sampleId, columns, fillEmpty }).then(j<{ results: RenderResult[] }>),
  health: () => fetch("/api/health").then(j<Health>),
  installPlan: () => fetch("/api/install").then(j<InstallPlan>),
  /** Throws NeedsConfirm when another tool's statusLine is set and `confirmReplace` is false. */
  install: async (confirmReplace = false) => {
    const res = await post("/api/install", { confirmReplace });
    if (res.status === 409) throw new NeedsConfirm(((await res.json()) as { current?: unknown }).current ?? null);
    return j<{ settingsFile: string; backup: string | null }>(res);
  },
  uninstall: () => post("/api/uninstall", {}).then(j<{ settingsFile: string; restored: unknown; removed: boolean }>),
  /** Set our statusLine's refreshInterval in seconds, or clear it with null (refresh on session events only). */
  setRefreshInterval: (seconds: number | null) => post("/api/refresh-interval", { seconds }).then(j<{ settingsFile: string; refreshInterval: number | null; unchanged: boolean }>),
  reset: (sessionId?: string) => post("/api/reset", { sessionId }).then(j<{ sessionId: string; baseline: { at: number } }>),
  undoReset: (sessionId: string) => post("/api/reset", { sessionId, undo: true }).then(j<{ ok: true }>),
};
