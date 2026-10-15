/**
 * User widget plugins: any *.js / *.mjs / *.ts file in the plugin dirs whose default export is a
 * widget definition (or an array of them). Load failures are collected, never thrown.
 *
 * Trust model: a plugin is code that runs on every statusline tick. The user's own widgets dir and
 * the dirs listed in the *user* config always load. A project's `.claude/claude-code-super-statusline/widgets/`
 * loads only when the project is listed in `plugins.trustedProjects` — otherwise cloning a repo and
 * opening it in Claude Code would execute whatever that repo ships. (Project config files can't set
 * `plugins` at all; loadEffectiveConfig drops it.)
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { APP_NAME, legacyPaths, newOrLegacy } from "../data/app-name.js";
import { userConfigDir } from "./config.js";
import { registerWidget } from "./registry.js";
import type { FooterConfig, WidgetDefinition } from "./types.js";

export interface PluginLoadReport {
  dirs: string[];
  loaded: Array<{ file: string; ids: string[] }>;
  errors: Array<{ file: string; message: string }>;
  /** Plugin dirs that exist but were deliberately not loaded, with a human-readable reason. */
  skipped: Array<{ dir: string; reason: string }>;
}

/**
 * Where a project keeps its own widgets: `.claude/claude-code-super-statusline/widgets/`, or the
 * pre-0.4.0 `.claude/claude-code-ssp/widgets/` if that is the one it has. Either way the trust rule
 * below applies to it.
 */
export function projectWidgetsDir(cwd: string): string {
  const dir = path.join(cwd, ".claude");
  return newOrLegacy(path.join(dir, APP_NAME, "widgets"), ...legacyPaths(dir, "widgets"));
}

function canonical(p: string): string {
  const expanded = p.replace(/^~(?=$|[\\/])/, os.homedir());
  try {
    return fs.realpathSync(expanded);
  } catch {
    return path.resolve(expanded);
  }
}

/** Is `cwd` one of the trusted project dirs, or inside one? Symlinks are resolved on both sides. */
export function isTrustedProject(cwd: string, trusted: readonly string[]): boolean {
  const dir = canonical(cwd);
  return trusted.some((t) => {
    const root = canonical(t);
    return dir === root || dir.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
  });
}

/** Resolve which plugin dirs load for this cwd, and which existing ones were held back. */
export function resolvePluginDirs(config: FooterConfig, cwd?: string): { dirs: string[]; skipped: PluginLoadReport["skipped"] } {
  const dirs = [path.join(userConfigDir(), "widgets")];
  const skipped: PluginLoadReport["skipped"] = [];
  if (cwd) {
    const projectDir = projectWidgetsDir(cwd);
    if (isTrustedProject(cwd, config.plugins.trustedProjects ?? [])) dirs.push(projectDir);
    else if (fs.existsSync(projectDir)) {
      skipped.push({ dir: projectDir, reason: `project not trusted — add ${cwd} to plugins.trustedProjects in your user config to load its widgets` });
    }
  }
  for (const d of config.plugins.dirs) dirs.push(canonical(d));
  return { dirs: [...new Set(dirs)], skipped };
}

/** The dirs that will actually be scanned (kept for callers that only need the list). */
export function pluginDirs(config: FooterConfig, cwd?: string): string[] {
  return resolvePluginDirs(config, cwd).dirs;
}

function isDef(v: unknown): v is WidgetDefinition {
  return typeof v === "object" && v !== null && typeof (v as WidgetDefinition).id === "string" && typeof (v as WidgetDefinition).render === "function";
}

export async function loadPlugins(config: FooterConfig, cwd?: string): Promise<PluginLoadReport> {
  const { dirs, skipped } = resolvePluginDirs(config, cwd);
  const report: PluginLoadReport = { dirs, loaded: [], errors: [], skipped };
  for (const dir of report.dirs) {
    let files: string[];
    try {
      files = fs.readdirSync(dir).filter((f) => /\.(m?js|ts)$/.test(f) && !f.endsWith(".d.ts"));
    } catch {
      continue;
    }
    for (const f of files.sort()) {
      const file = path.join(dir, f);
      try {
        const mod = (await import(pathToFileURL(file).href)) as { default?: unknown };
        const defs = Array.isArray(mod.default) ? mod.default : [mod.default];
        const ids: string[] = [];
        for (const d of defs) {
          if (!isDef(d)) throw new Error("default export is not a widget definition ({ id, render, ... })");
          registerWidget(d, "plugin", file);
          ids.push(d.id);
        }
        report.loaded.push({ file, ids });
      } catch (err) {
        report.errors.push({ file, message: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  return report;
}
