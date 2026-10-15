/**
 * install.sh, run against a stand-in `claude` that logs every call and answers `--version` and the
 * two `--json` listings from the environment: the script must install on a first run, update on
 * later ones, and stop early — before touching any plugin — when Claude Code or Bun is missing or
 * too old. The real Bun is on PATH (the script parses the JSON with it) except where a test takes
 * it away; HOME is a temp dir, so no real ~/.bun or ~/.claude is ever seen.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const SCRIPT = path.resolve(import.meta.dir, "../install.sh");
const BUN_DIR = path.dirname(process.execPath);
let tmp = "";
let stubDir = "";
let logFile = "";

beforeAll(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "install-sh-")));
  stubDir = path.join(tmp, "bin");
  fs.mkdirSync(stubDir);
  logFile = path.join(tmp, "claude.log");
  fs.writeFileSync(
    path.join(stubDir, "claude"),
    `#!/bin/bash
echo "$*" >> "$STUB_LOG"
case "$*" in
  "--version") echo "\${STUB_CLAUDE_VERSION:-2.1.283} (Claude Code)" ;;
  "plugin list --json") echo "\${STUB_PLUGINS:-[]}" ;;
  "plugin marketplace list --json") echo "\${STUB_MARKETS:-[]}" ;;
esac
`,
    { mode: 0o755 },
  );
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const OURS = { id: "super-statusline@claude-code-super-statusline", version: "0.4.1" };
const GITHUB_MARKET = { name: "claude-code-super-statusline", source: "github", repo: "jinhuang712/claude-code-super-statusline" };
const LOCAL_MARKET = { name: "claude-code-super-statusline", source: "directory", path: "/Users/you/dev/claude-code-super-statusline" };

function run(opts: { plugins?: object[]; markets?: object[]; claudeVersion?: string; withBun?: boolean; withClaude?: boolean; args?: string[] } = {}) {
  fs.writeFileSync(logFile, "");
  const dirs = [opts.withClaude === false ? null : stubDir, opts.withBun === false ? null : BUN_DIR, "/usr/bin", "/bin"].filter(Boolean);
  const r = Bun.spawnSync({
    cmd: ["/bin/bash", SCRIPT, ...(opts.args ?? [])],
    env: {
      PATH: dirs.join(":"),
      HOME: tmp,
      STUB_LOG: logFile,
      STUB_PLUGINS: JSON.stringify(opts.plugins ?? []),
      STUB_MARKETS: JSON.stringify(opts.markets ?? []),
      STUB_CLAUDE_VERSION: opts.claudeVersion ?? "2.1.283",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const calls = fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean);
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString(), calls };
}

/** The calls that change something (not the version check or the two listings). */
const changes = (calls: string[]) => calls.filter((c) => c !== "--version" && !c.endsWith("--json"));

describe("install.sh", () => {
  test("a first run adds the marketplace, installs the plugin, and says what to do next", () => {
    const r = run();
    expect(r.code).toBe(0);
    expect(changes(r.calls)).toEqual(["plugin marketplace add jinhuang712/claude-super-statusline", "plugin install super-statusline@claude-code-super-statusline"]);
    expect(r.out).toContain("/super-statusline:config");
  });

  test("a later run updates the marketplace and the plugin instead", () => {
    const r = run({ plugins: [OURS], markets: [GITHUB_MARKET] });
    expect(r.code).toBe(0);
    expect(changes(r.calls)).toEqual(["plugin marketplace update claude-code-super-statusline", "plugin update super-statusline@claude-code-super-statusline"]);
    expect(r.out).toContain("updated");
  });

  test("a marketplace that is a local checkout is updated too, with a note to git pull there", () => {
    const r = run({ plugins: [OURS], markets: [LOCAL_MARKET] });
    expect(r.code).toBe(0);
    expect(changes(r.calls)).toContain("plugin update super-statusline@claude-code-super-statusline");
    expect(r.out).toContain(`git -C "${LOCAL_MARKET.path}" pull`);
  });

  test("an added marketplace without the plugin installs it without adding the marketplace again", () => {
    const r = run({ markets: [GITHUB_MARKET] });
    expect(r.code).toBe(0);
    expect(changes(r.calls)).toEqual(["plugin marketplace update claude-code-super-statusline", "plugin install super-statusline@claude-code-super-statusline"]);
  });

  test("the old ssp plugin gets a note on how to remove it once settings have moved", () => {
    const r = run({ plugins: [{ id: "ssp@claude-code-ssp", version: "0.3.3" }] });
    expect(r.code).toBe(0);
    expect(r.out).toContain("claude plugin uninstall ssp@claude-code-ssp");
  });

  test("Claude Code older than 2.1.251 stops the script before any plugin change", () => {
    const r = run({ claudeVersion: "2.1.200" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("too old");
    expect(changes(r.calls)).toEqual([]);
  });

  test("no claude on PATH stops the script with where to get it", () => {
    const r = run({ withClaude: false });
    expect(r.code).toBe(1);
    expect(r.out).toContain("claude command isn't on your PATH");
  });

  test("no Bun and nobody to ask (no terminal, no --yes) stops the script before any plugin change", () => {
    const r = run({ withBun: false });
    expect(r.code).toBe(1);
    expect(r.out).toContain("Bun is required");
    expect(changes(r.calls)).toEqual([]);
  });

  test("an unknown option is refused", () => {
    const r = run({ args: ["--frobnicate"] });
    expect(r.code).toBe(2);
    expect(r.calls).toEqual([]);
  });
});
