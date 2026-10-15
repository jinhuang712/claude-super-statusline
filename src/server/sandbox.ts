/**
 * `serve --sandbox`: run the configurator against throwaway copies of the user's state, so browser
 * automation (or a curious click) can't change the real statusline.
 *
 * Every path the server writes is derived lazily from the environment — CLAUDE_SUPER_STATUSLINE_CONFIG (user
 * config), CLAUDE_CONFIG_DIR (settings.json, samples, caches, reset baselines), XDG_CONFIG_HOME (user
 * widgets dir) and the process cwd (project layer) — so pointing those at a temp root before the first
 * request is enough. The real files are only ever *read*, once, to seed the copies.
 *
 * Project-scope saves are the one write that can still name a real directory (`?cwd=` of a captured
 * session); serve.ts refuses those outside the sandbox root via isInsideSandbox().
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { samplesDir } from "../core/capture.js";
import { userConfigPath } from "../core/config.js";
import { APP_NAME, freezeLegacyDirs } from "../data/app-name.js";
import { LEGACY_PREVIOUS_KEYS, PREVIOUS_KEY, settingsPath } from "./install.js";

let sandboxRoot: string | null = null;

/** The sandbox root when running with --sandbox, else null. */
export function currentSandbox(): string | null {
  return sandboxRoot;
}

/** True when `target` lies inside the active sandbox (always true when there is no sandbox). */
export function isInsideSandbox(target: string): boolean {
  if (!sandboxRoot) return true;
  const resolved = path.resolve(target);
  return resolved === sandboxRoot || resolved.startsWith(sandboxRoot + path.sep);
}

function copyIfExists(from: string, to: string): boolean {
  try {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create the sandbox, seed it, and repoint the environment at it. Returns the root and what got
 * copied. Call before the server handles any request.
 */
export function enterServeSandbox(): { root: string; seeded: string[] } {
  // Resolve the real locations while the environment still points at them — without moving a
  // pre-0.4.0 folder to its new name: the real files are only read here.
  freezeLegacyDirs();
  const real = { samples: samplesDir(), userConfig: userConfigPath(), settings: settingsPath() };
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "claude-code-super-statusline-sandbox-")));
  const claudeDir = path.join(root, "claude");
  const seeded: string[] = [];

  if (copyIfExists(real.samples, path.join(claudeDir, "plugins", APP_NAME, "samples"))) seeded.push("samples");
  if (copyIfExists(real.userConfig, path.join(root, "config.json"))) seeded.push("user config");
  // Only the statusLine keys: a real settings.json can carry `env` with API keys, hooks, permissions…
  // none of which the configurator needs, so none of it is copied into a temp dir.
  try {
    const s = JSON.parse(fs.readFileSync(real.settings, "utf8")) as Record<string, unknown>;
    const subset: Record<string, unknown> = {};
    if (s.statusLine !== undefined) subset.statusLine = s.statusLine;
    for (const key of [PREVIOUS_KEY, ...LEGACY_PREVIOUS_KEYS]) if (s[key] !== undefined) subset[key] = s[key];
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, "settings.json"), JSON.stringify(subset, null, 2) + "\n");
    seeded.push("statusLine from settings.json");
  } catch {
    /* no settings yet — the sandbox starts like a fresh install */
  }

  process.env.CLAUDE_SUPER_STATUSLINE_CONFIG = path.join(root, "config.json");
  process.env.CLAUDE_CONFIG_DIR = claudeDir;
  process.env.XDG_CONFIG_HOME = path.join(root, "xdg");
  const project = path.join(root, "project");
  fs.mkdirSync(project, { recursive: true });
  process.chdir(project);
  sandboxRoot = root;
  // Throwaway by definition: remove it when the server is stopped (Ctrl+C, kill), so repeated
  // automation runs don't pile up copies of the user's samples in the temp dir.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      fs.rmSync(root, { recursive: true, force: true });
      process.exit(0);
    });
  }
  return { root, seeded };
}
