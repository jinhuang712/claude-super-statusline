/**
 * Test preload (wired up in bunfig.toml): points every directory the code can write to at a
 * throwaway temp root BEFORE any test module runs, so `bun test` can never touch the developer's
 * real ~/.claude (samples, caches, reset baselines, settings.json) or ~/.config/claude-super-statusline
 * (nor move a pre-0.4.0 ~/.config/claude-code-ssp to that name).
 *
 * Why these variables and not just HOME: Bun caches `os.homedir()` at startup, so changing HOME
 * here does not redirect the current process. Every write path, however, resolves through one of
 * the variables below at call time:
 *   - CLAUDE_CONFIG_DIR      → data root (samples, git/transcript caches, resets) and settings.json
 *   - XDG_CONFIG_HOME        → user config dir (plugins dir, default config path)
 *   - CLAUDE_SUPER_STATUSLINE_CONFIG → explicit user config file
 * HOME is still set so that child processes (the CLI budget test, git) start with the temp home.
 * `tests/isolation.test.ts` asserts the redirection actually holds.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ssp-test-"));
const dirs = {
  claude: path.join(root, "claude"),
  xdg: path.join(root, "xdg"),
  home: path.join(root, "home"),
};
for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });

process.env.SSP_TEST_ROOT = root;
process.env.CLAUDE_CONFIG_DIR = dirs.claude;
process.env.XDG_CONFIG_HOME = dirs.xdg;
// Both spellings, so a developer's own CLAUDE_CODE_SUPER_STATUSLINE_CONFIG (the pre-rename name, still
// honoured) cannot point a test at a real config either.
delete process.env.CLAUDE_CODE_SUPER_STATUSLINE_CONFIG;
process.env.CLAUDE_SUPER_STATUSLINE_CONFIG = path.join(dirs.xdg, "claude-super-statusline", "config.json");
process.env.HOME = dirs.home;
// The ambient Claude session id (set when tests run inside Claude Code) would make reset tests
// depend on whoever ran them; tests that need one set it explicitly.
delete process.env.CLAUDE_CODE_SESSION_ID;

process.on("exit", () => {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    /* best effort: a leftover temp dir is harmless */
  }
});
