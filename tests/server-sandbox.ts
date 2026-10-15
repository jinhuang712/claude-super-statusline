/**
 * Test helper: point every path the server or installer touches (Claude's settings.json, our user
 * config, the samples dir, HOME itself) at a fresh temp directory, and put the real values back
 * afterwards. Server tests must never read or write the developer's real ~/.claude or ~/.config.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { APP_NAME } from "../src/data/app-name.ts";

const KEYS = ["HOME", "CLAUDE_CONFIG_DIR", "XDG_CONFIG_HOME", "CLAUDE_SUPER_STATUSLINE_CONFIG", "CLAUDE_CODE_SUPER_STATUSLINE_CONFIG"] as const;

export interface Sandbox {
  root: string;
  /** Claude Code's config dir inside the sandbox (settings.json, plugins/claude-super-statusline/samples). */
  claudeDir: string;
  /** Our user config file inside the sandbox. */
  userConfig: string;
  restore(): void;
}

export function enterSandbox(): Sandbox {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ssp-test-")));
  const claudeDir = path.join(root, "claude");
  const userConfig = path.join(root, "xdg", APP_NAME, "config.json");
  fs.mkdirSync(claudeDir, { recursive: true });
  process.env.HOME = path.join(root, "home");
  process.env.CLAUDE_CONFIG_DIR = claudeDir;
  process.env.XDG_CONFIG_HOME = path.join(root, "xdg");
  delete process.env.CLAUDE_CODE_SUPER_STATUSLINE_CONFIG;
  process.env.CLAUDE_SUPER_STATUSLINE_CONFIG = userConfig;
  fs.mkdirSync(process.env.HOME, { recursive: true });
  return {
    root,
    claudeDir,
    userConfig,
    restore() {
      for (const k of KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * Write a captured-sample file the way `render` does, so /api/samples and ?cwd= have something to
 * find. `appDir` = LEGACY_APP_NAME stages a pre-0.4.0 data folder.
 */
export function writeSample(claudeDir: string, sessionId: string, payload: Record<string, unknown>, capturedAt = Date.now(), appDir = APP_NAME): string {
  const dir = path.join(claudeDir, "plugins", appDir, "samples");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.json`);
  fs.writeFileSync(file, JSON.stringify({ capturedAt, payload: { session_id: sessionId, ...payload } }));
  return file;
}
