/**
 * Config loading with three layers: defaults → user file → project file.
 * Objects deep-merge; `lines` and `desktop.lines` replace wholesale.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { adoptLegacyDir, APP_NAME, LEGACY_APP_NAME, newOrLegacy } from "../data/app-name.js";
import { DEFAULT_DESKTOP_LINES, readDesktopLines } from "./desktop.js";
import type { FooterConfig, LineConfig, WidgetInstance } from "./types.js";

/** 2: ahead/behind and the file stats moved from git.branch to git.linesChanged (migrateGitBranchParts). */
export const CONFIG_VERSION = 2 as const;

/** The user's own folder: config.json and widgets/. A pre-0.4.0 `claude-code-ssp` one is moved here on first use. */
export function userConfigDir(env: NodeJS.ProcessEnv = process.env, homeDir = os.homedir()): string {
  const xdg = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim() ? env.XDG_CONFIG_HOME : path.join(homeDir, ".config");
  return adoptLegacyDir(path.join(xdg, APP_NAME), path.join(xdg, LEGACY_APP_NAME));
}

export function userConfigPath(env: NodeJS.ProcessEnv = process.env, homeDir = os.homedir()): string {
  const explicit = env.CLAUDE_CODE_SUPER_STATUSLINE_CONFIG?.trim();
  if (explicit) return path.resolve(explicit.replace(/^~(?=$|[\\/])/, homeDir));
  return path.join(userConfigDir(env, homeDir), "config.json");
}

/** A project's overlay, `.claude/claude-code-super-statusline.json` — or its pre-0.4.0 `claude-code-ssp.json` if that is the one it has. */
export function projectConfigPath(cwd: string): string {
  const dir = path.join(cwd, ".claude");
  return newOrLegacy(path.join(dir, `${APP_NAME}.json`), path.join(dir, `${LEGACY_APP_NAME}.json`));
}

export const DEFAULT_LINES: LineConfig[] = [
  {
    // Changes with only ↑N ↓N: what git.branch showed by default before config version 2.
    left: [{ widget: "project.path" }, { widget: "git.branch" }, { widget: "git.linesChanged", options: { lines: false, aheadBehind: true } }],
    right: [{ widget: "model.badge" }, { widget: "session.duration" }, { widget: "cost.session" }],
  },
  {
    left: [{ widget: "usage.windows" }],
    right: [{ widget: "context.bar" }],
  },
  {
    left: [{ widget: "tokens.session" }],
    right: [{ widget: "session.started" }, { widget: "session.lastReply" }],
  },
  {
    left: [{ widget: "activity.agents" }, { widget: "activity.todos" }],
  },
];

export const DEFAULT_CONFIG: FooterConfig = {
  version: CONFIG_VERSION,
  theme: "default",
  colorLevel: "auto",
  separator: " │ ",
  colorMode: "thresholds",
  columnsOffset: 4,
  emptyText: "",
  lines: DEFAULT_LINES,
  desktop: { lines: DEFAULT_DESKTOP_LINES },
  git: { enabled: true, cacheMs: 2000 },
  plugins: { dirs: [], trustedProjects: [] },
  captureSamples: true,
};

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
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Deep-merge where arrays and primitives from `over` replace `base`. */
export function mergeConfig<T>(base: T, over: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(over)) return (over === undefined ? base : (over as T));
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? mergeConfig(out[k], v) : v;
  }
  return out as T;
}

/**
 * Up to 0.4.1 each percentage widget had its own `options.colorMode`; now it is one top-level
 * `colorMode`. A config (or layer) that doesn't set the top-level key yet gets it from its widgets:
 * "gradient" if any widget asked for the gradient, since that is the choice somebody made — the
 * default was "thresholds". A config that mixed the two comes out all-gradient; that is the one
 * look it can't keep, and the README says so.
 *
 * Layers are lifted as they are read, not only the merged result: the panel saves the diff between
 * the effective configs onto the layer (web/src/layers.ts), so a value lifted only in the merge
 * would never be written, and would be lost the first time the lines were edited and saved without
 * the old widget options (normalizeConfig drops them).
 */
export function liftLegacyColorMode<T extends Partial<FooterConfig>>(value: T): T {
  if (value.colorMode !== undefined || !Array.isArray(value.lines)) return value;
  const gradient = value.lines.some(
    (l) => isPlainObject(l) && (["left", "center", "right"] as const).some((z) => Array.isArray(l[z]) && l[z]!.some((w) => isPlainObject(w) && isPlainObject(w.options) && w.options.colorMode === "gradient")),
  );
  return gradient ? { ...value, colorMode: "gradient" } : value;
}

/**
 * Config version 2 moved ahead/behind (`showAheadBehind`, on by default) and the file stats
 * (`showFileStats`) from git.branch to Changes (git.linesChanged). A version-1 layer is carried
 * over so nobody's statusline loses them:
 *   - a Changes widget on the same line takes them (`aheadBehind`, `files: "symbols"`), unless it
 *     already sets those options itself;
 *   - otherwise a Changes widget showing only them (`lines: false`) is inserted right after the branch.
 * The result is marked version 2, which is what makes this run once: the panel saves the layer as
 * read (migrated) along with the version, and a version-2 layer is never touched again — so a
 * Changes widget removed on purpose later doesn't come back. A layer with lines but no version (hand
 * written) counts as version 1. Like liftLegacyColorMode, this runs on each layer as it is read.
 */
export function migrateGitBranchParts<T extends Partial<FooterConfig>>(value: T): T {
  if (!Array.isArray(value.lines) || (typeof value.version === "number" && value.version >= 2)) return value;
  const ZONES = ["left", "center", "right"] as const;
  const lines = value.lines.map((line) => {
    if (!isPlainObject(line)) return line;
    // Pass 1: copy the zones, strip the two options off every branch, and note what they showed.
    const out: LineConfig = { ...line };
    let ab = false;
    let fs = false;
    let branchAt: { zone: (typeof ZONES)[number]; index: number } | null = null;
    for (const zone of ZONES) {
      if (!Array.isArray(line[zone])) continue;
      out[zone] = line[zone]!.map((w, index) => {
        if (!isPlainObject(w) || w.widget !== "git.branch") return w;
        const opts = isPlainObject(w.options) ? w.options : {};
        const { showAheadBehind, showFileStats, ...rest } = opts as Record<string, unknown>;
        // The old defaults: ahead/behind on, file stats off.
        ab ||= showAheadBehind !== false;
        fs ||= showFileStats === true;
        branchAt ??= { zone, index };
        return isPlainObject(w.options) ? { ...w, options: rest } : w;
      });
    }
    if (!branchAt || (!ab && !fs)) return out;
    // Pass 2: hand them to the line's first Changes widget, or add one right after the branch.
    for (const zone of ZONES) {
      const list = out[zone];
      const i = Array.isArray(list) ? list.findIndex((w) => isPlainObject(w) && w.widget === "git.linesChanged") : -1;
      if (i < 0) continue;
      const target = list![i]!;
      const o: Record<string, unknown> = { ...(isPlainObject(target.options) ? target.options : {}) };
      if (ab && o.aheadBehind === undefined) o.aheadBehind = true;
      if (fs && (o.files === undefined || o.files === "off")) o.files = "symbols";
      out[zone] = list!.map((w, j) => (j === i ? { ...target, options: o } : w));
      return out;
    }
    const { zone, index } = branchAt as { zone: (typeof ZONES)[number]; index: number };
    const inserted: WidgetInstance = { widget: "git.linesChanged", options: { lines: false, ...(ab ? { aheadBehind: true } : {}), ...(fs ? { files: "symbols" } : {}) } };
    out[zone] = [...out[zone]!.slice(0, index + 1), inserted, ...out[zone]!.slice(index + 1)];
    return out;
  });
  return { ...value, lines, version: 2 };
}

/** A widget instance without the pre-0.4.2 per-widget colorMode, which nothing reads any more. */
function withoutLegacyColorMode(w: WidgetInstance): WidgetInstance {
  if (!isPlainObject(w.options) || !("colorMode" in w.options)) return w;
  const { colorMode: _dropped, ...options } = w.options;
  return { ...w, options };
}

function readLayer(name: ConfigLayer["name"], filePath: string | null): ConfigLayer {
  if (!filePath) return { name, path: null, exists: false, value: null };
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) return { name, path: filePath, exists: true, value: null, error: "top-level value is not an object" };
    return { name, path: filePath, exists: true, value: migrateGitBranchParts(liftLegacyColorMode(parsed as Partial<FooterConfig>)) };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return { name, path: filePath, exists: false, value: null };
    return { name, path: filePath, exists: true, value: null, error: e.message };
  }
}

/** Minimal shape validation; unknown keys are kept so plugins can stash settings. */
export function normalizeConfig(input: Partial<FooterConfig>): FooterConfig {
  const merged = mergeConfig(DEFAULT_CONFIG, migrateGitBranchParts(liftLegacyColorMode(input)));
  const lines = Array.isArray(merged.lines) ? merged.lines.filter(isPlainObject) : DEFAULT_LINES;
  const cleanZone = (z: WidgetInstance[] | undefined): WidgetInstance[] => (Array.isArray(z) ? z.filter((w) => isPlainObject(w) && typeof w.widget === "string").map(withoutLegacyColorMode) : []);
  const cleanLine = (l: LineConfig): LineConfig => ({
    ...l,
    left: cleanZone(l.left),
    center: cleanZone(l.center),
    right: cleanZone(l.right),
  });
  return {
    ...merged,
    version: CONFIG_VERSION,
    separator: typeof merged.separator === "string" ? merged.separator : DEFAULT_CONFIG.separator,
    colorMode: merged.colorMode === "gradient" ? "gradient" : "thresholds",
    colorLevel: ["auto", "truecolor", "256", "16", "none"].includes(merged.colorLevel as string) ? merged.colorLevel : "auto",
    columnsOffset: Number.isFinite(merged.columnsOffset) ? Math.max(0, Math.floor(Number(merged.columnsOffset))) : DEFAULT_CONFIG.columnsOffset,
    emptyText: typeof merged.emptyText === "string" ? merged.emptyText : DEFAULT_CONFIG.emptyText,
    lines: lines.map(cleanLine),
    desktop: { lines: readDesktopLines(merged) },
    git: { enabled: merged.git?.enabled !== false, cacheMs: Number.isFinite(merged.git?.cacheMs) ? Number(merged.git.cacheMs) : 2000 },
    plugins: {
      dirs: Array.isArray(merged.plugins?.dirs) ? merged.plugins.dirs.filter((d) => typeof d === "string") : [],
      trustedProjects: Array.isArray(merged.plugins?.trustedProjects) ? merged.plugins.trustedProjects.filter((d) => typeof d === "string" && d !== "") : [],
    },
    captureSamples: merged.captureSamples !== false,
  };
}

function withoutPlugins(value: Partial<FooterConfig>): Partial<FooterConfig> {
  const { plugins: _ignored, ...rest } = value;
  return rest;
}

export function loadEffectiveConfig(cwd: string | undefined, env: NodeJS.ProcessEnv = process.env): EffectiveConfig {
  const layers: ConfigLayer[] = [
    { name: "defaults", path: null, exists: true, value: DEFAULT_CONFIG },
    readLayer("user", userConfigPath(env)),
    readLayer("project", cwd ? projectConfigPath(cwd) : null),
  ];
  let acc: Partial<FooterConfig> = {};
  for (const layer of layers) {
    if (!layer.value) continue;
    // A project file travels with the repo, so whoever wrote the repo wrote it. `plugins` decides which
    // code the statusline executes; letting a cloned repo set it (or trust itself) would turn "open this
    // project in Claude Code" into "run this project's code". The layer is still shown as-is in the UI.
    const value = layer.name === "project" ? withoutPlugins(layer.value) : layer.value;
    acc = mergeConfig(acc, value);
  }
  return { config: normalizeConfig(acc), layers };
}

export function writeUserConfig(config: Partial<FooterConfig>, env: NodeJS.ProcessEnv = process.env): string {
  const target = userConfigPath(env);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ $schema: "https://github.com/jinhuang712/claude-code-super-statusline/schema/config.json", ...config }, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, target);
  return target;
}

export function writeProjectConfig(cwd: string, config: Partial<FooterConfig>): string {
  const target = projectConfigPath(cwd);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n");
  fs.renameSync(tmp, target);
  return target;
}
