import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  adoptLegacyStatusLine,
  install,
  isOurStatusLine,
  launcherCommand,
  LEGACY_PREVIOUS_KEY,
  LEGACY_PREVIOUS_KEYS,
  NeedsConfirmError,
  planInstall,
  pluginCacheBase,
  PREVIOUS_KEY,
  settingsPath,
  uninstall,
} from "../src/server/install.ts";
import { enterSandbox, type Sandbox } from "./server-sandbox.ts";

const HUD = { type: "command", command: "bash -c 'exec bun ~/.claude/plugins/cache/claude-hud/claude-hud/1.2.0/src/index.ts'", refreshInterval: 5 };
const OURS_OLD = { type: "command", command: '/opt/homebrew/bin/bun "/Users/me/dev/claude-code-ssp/src/cli/main.ts" render', padding: 0 };
const OURS_NEW = '/opt/homebrew/bin/bun "/Users/me/elsewhere/claude-code-super-statusline/src/cli/main.ts" render';
/** What a 0.3.x plugin install left in settings.json (the plugin was called `ssp` then), with a user tweak. */
const OLD_PLUGIN = { type: "command", command: launcherCommand("/h/.claude/plugins/cache/claude-code-ssp/ssp/0.3.3/src/cli/main.ts", "/usr/bin/bun"), padding: 0, refreshInterval: 3 };
const NEW_PLUGIN_ENTRY = "/h/.claude/plugins/cache/claude-code-super-statusline/super-statusline/0.4.0/src/cli/main.ts";

let sb: Sandbox;
const settings = () => JSON.parse(fs.readFileSync(settingsPath(), "utf8")) as Record<string, unknown>;
const seed = (value: Record<string, unknown>) => {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(value));
};

beforeAll(() => {
  sb = enterSandbox();
});
afterEach(() => fs.rmSync(path.dirname(settingsPath()), { recursive: true, force: true }));
afterAll(() => sb.restore());

describe("isOurStatusLine", () => {
  test("recognises checkout and plugin-cache commands, rejects everyone else's", () => {
    expect(isOurStatusLine(OURS_OLD)).toBe(true);
    expect(isOurStatusLine({ command: launcherCommand("/h/.claude/plugins/cache/claude-code-ssp/ssp/0.2.0/src/cli/main.ts", "/usr/bin/bun") })).toBe(true);
    expect(isOurStatusLine(HUD)).toBe(false);
    expect(isOurStatusLine({ command: "~/.claude/statusline.sh" })).toBe(false);
    expect(isOurStatusLine({ command: 'bun "/x/other-tool/src/cli/main.ts" render' })).toBe(false);
    expect(isOurStatusLine(null)).toBe(false);
  });

  test("recognises the names from before and after the 0.4.0 rename, from any marketplace", () => {
    for (const entry of [
      NEW_PLUGIN_ENTRY,
      "/h/.claude/plugins/cache/my-fork/super-statusline/0.4.0/src/cli/main.ts",
      "/h/.claude/plugins/cache/my-fork/ssp/0.3.3/src/cli/main.ts",
      "/Users/me/dev/claude-code-super-statusline/src/cli/main.ts",
      "/Users/me/dev/claude-super-statusline/src/cli/main.ts",
      "/h/.claude/plugins/cache/claude-super-statusline/super-statusline/0.6.0/src/cli/main.ts",
    ]) {
      expect(isOurStatusLine({ command: launcherCommand(entry, "/usr/bin/bun") })).toBe(true);
    }
    expect(isOurStatusLine({ command: 'bun "/x/not-ssp-tool/src/cli/main.ts" render' })).toBe(false);
  });
});

describe("a statusline parked by 0.3.x (under the old key name)", () => {
  test("planInstall reports it, install moves it to the new key, uninstall restores it", () => {
    seed({ statusLine: OLD_PLUGIN, [LEGACY_PREVIOUS_KEY]: HUD });
    expect(planInstall({ command: OURS_NEW }).savedPrevious).toEqual(HUD);
    install({ command: OURS_NEW });
    expect(settings()[PREVIOUS_KEY]).toEqual(HUD);
    expect(settings()[LEGACY_PREVIOUS_KEY]).toBeUndefined();
    expect(uninstall()).toMatchObject({ removed: true, restored: HUD });
  });

  test("uninstall restores it straight from the old key and drops the key", () => {
    seed({ statusLine: OLD_PLUGIN, [LEGACY_PREVIOUS_KEY]: HUD, theme: "dark" });
    expect(uninstall()).toMatchObject({ removed: true, restored: HUD });
    expect(settings()).toEqual({ statusLine: HUD, theme: "dark" });
  });

  test("an otherwise identical entry is still rewritten, so the key moves", () => {
    seed({ statusLine: { ...OURS_OLD }, [LEGACY_PREVIOUS_KEY]: HUD });
    expect(install({ command: OURS_OLD.command }).unchanged).toBe(false);
    expect(settings()[PREVIOUS_KEY]).toEqual(HUD);
  });
});

describe("a statusline parked under the key of the previous name", () => {
  const MID_KEY = LEGACY_PREVIOUS_KEYS[0];

  test("install moves it to the new key and uninstall restores it", () => {
    seed({ statusLine: OURS_OLD, [MID_KEY]: HUD });
    expect(planInstall({ command: OURS_NEW }).savedPrevious).toEqual(HUD);
    install({ command: OURS_NEW });
    expect(settings()[PREVIOUS_KEY]).toEqual(HUD);
    expect(settings()[MID_KEY]).toBeUndefined();
    expect(uninstall()).toMatchObject({ removed: true, restored: HUD });
    expect(settings()).toEqual({ statusLine: HUD });
  });

  test("uninstall restores it straight from that key and drops it", () => {
    seed({ statusLine: OURS_OLD, [MID_KEY]: HUD, theme: "dark" });
    expect(uninstall()).toMatchObject({ removed: true, restored: HUD });
    expect(settings()).toEqual({ statusLine: HUD, theme: "dark" });
  });
});

describe("adoptLegacyStatusLine", () => {
  test("points the old ssp plugin's statusLine at the new plugin, keeping tweaks and the parked original", () => {
    seed({ statusLine: OLD_PLUGIN, [LEGACY_PREVIOUS_KEY]: HUD });
    expect(adoptLegacyStatusLine(NEW_PLUGIN_ENTRY)?.unchanged).toBe(false);
    expect(settings().statusLine).toEqual({ ...OLD_PLUGIN, command: launcherCommand(NEW_PLUGIN_ENTRY) });
    expect(settings()[PREVIOUS_KEY]).toEqual(HUD);
    expect(adoptLegacyStatusLine(NEW_PLUGIN_ENTRY)).toBeNull(); // once: the command no longer runs the old plugin
  });

  test("leaves everything else alone: someone else's statusline, a checkout, the new plugin", () => {
    for (const statusLine of [HUD, OURS_OLD, { type: "command", command: launcherCommand(NEW_PLUGIN_ENTRY) }]) {
      seed({ statusLine });
      expect(adoptLegacyStatusLine(NEW_PLUGIN_ENTRY)).toBeNull();
      expect(settings().statusLine).toEqual(statusLine);
    }
  });

  test("only a plugin install takes over, never a checkout", () => {
    seed({ statusLine: OLD_PLUGIN });
    expect(adoptLegacyStatusLine("/Users/me/dev/claude-code-super-statusline/src/cli/main.ts")).toBeNull();
    expect(settings().statusLine).toEqual(OLD_PLUGIN);
  });
});

describe("install", () => {
  test("fresh settings: writes our entry, parks nothing", () => {
    const r = install({ command: OURS_NEW });
    expect(r.replaced).toBeNull();
    expect(settings().statusLine).toMatchObject({ type: "command", command: OURS_NEW });
    expect(settings()[PREVIOUS_KEY]).toBeUndefined();
  });

  test("someone else's statusline needs consent and is left alone without it", () => {
    seed({ statusLine: HUD, theme: "dark" });
    expect(() => install({ command: OURS_NEW })).toThrow(NeedsConfirmError);
    expect(settings()).toEqual({ statusLine: HUD, theme: "dark" });
  });

  test("with consent, the foreign entry is parked and uninstall brings it back", () => {
    seed({ statusLine: HUD, theme: "dark" });
    const r = install({ command: OURS_NEW, confirmReplace: true });
    expect(r.replaced).toEqual(HUD);
    expect(settings()[PREVIOUS_KEY]).toEqual(HUD);
    const u = uninstall();
    expect(u).toMatchObject({ removed: true, restored: HUD });
    expect(settings()).toEqual({ statusLine: HUD, theme: "dark" });
  });

  test("reinstalling from another checkout never overwrites the parked original", () => {
    seed({ statusLine: HUD });
    install({ command: OURS_OLD.command, confirmReplace: true });
    install({ command: OURS_NEW }); // ours → ours: no consent needed, PREVIOUS_KEY untouched
    expect(settings()[PREVIOUS_KEY]).toEqual(HUD);
    expect((settings().statusLine as { command: string }).command).toBe(OURS_NEW);
  });

  test("reinstalling over our own entry keeps the user's tweaks to it", () => {
    seed({ statusLine: { ...OURS_OLD, refreshInterval: 7 } });
    install({ command: OURS_NEW });
    expect(settings().statusLine).toEqual({ ...OURS_OLD, refreshInterval: 7, command: OURS_NEW });
  });

  test("an identical entry is a no-op: no write, no backup", () => {
    seed({ statusLine: { ...OURS_OLD } });
    const r = install({ command: OURS_OLD.command });
    expect(r).toMatchObject({ unchanged: true, backup: null });
  });

  test("heals the legacy bug where our own old command was parked as 'previous'", () => {
    seed({ statusLine: OURS_OLD, [PREVIOUS_KEY]: { ...OURS_OLD, command: OURS_NEW } });
    install({ command: OURS_OLD.command });
    expect(settings()[PREVIOUS_KEY]).toBeUndefined();
  });

  test("planInstall reports the current entry and whether it is ours", () => {
    seed({ statusLine: HUD });
    const p = planInstall({ command: OURS_NEW });
    expect(p).toMatchObject({ current: HUD, previous: HUD, currentIsOurs: false, savedPrevious: null });
    expect(p.planned).toMatchObject({ type: "command", command: OURS_NEW });
  });
});

describe("uninstall", () => {
  test("never removes a statusline we didn't install", () => {
    seed({ statusLine: HUD });
    expect(uninstall()).toMatchObject({ removed: false, restored: null });
    expect(settings()).toEqual({ statusLine: HUD });
  });

  test("ours with nothing parked: the entry is removed", () => {
    seed({ statusLine: OURS_OLD, other: 1 });
    expect(uninstall()).toMatchObject({ removed: true, restored: null });
    expect(settings()).toEqual({ other: 1 });
  });

  test("a parked entry that is ours (legacy bug) is dropped, not 'restored'", () => {
    seed({ statusLine: OURS_OLD, [PREVIOUS_KEY]: { ...OURS_OLD, command: OURS_NEW } });
    expect(uninstall()).toMatchObject({ removed: true, restored: null });
    expect(settings()).toEqual({});
  });
});

describe("launcher command", () => {
  test("a checkout path is used as is, with the given bun", () => {
    expect(launcherCommand("/Users/me/claude-code-super-statusline/src/cli/main.ts", "/opt/homebrew/bin/bun")).toBe('/opt/homebrew/bin/bun "/Users/me/claude-code-super-statusline/src/cli/main.ts" render');
  });

  test("the default command never bakes in a versioned Homebrew Cellar path", () => {
    const cmd = planInstall().planned.command as string;
    if (Bun.which("bun")?.includes("/Cellar/")) return; // PATH itself points into the Cellar: nothing better to offer
    expect(cmd).not.toContain("/Cellar/");
  });

  test("from the plugin cache it runs the newest installed version, surviving plugin updates", () => {
    const base = path.join(sb.root, "cache with space", "plugins", "cache", "claude-code-super-statusline", "super-statusline");
    for (const v of ["0.9.0", "0.10.0", "0.2.0"]) {
      fs.mkdirSync(path.join(base, v, "src", "cli"), { recursive: true });
      fs.writeFileSync(path.join(base, v, "src", "cli", "main.ts"), `console.log("version ${v}", process.argv[2]);`);
    }
    fs.mkdirSync(path.join(base, "0.99.0-broken")); // a leftover dir without our entry point is ignored
    const entry = path.join(base, "0.2.0", "src", "cli", "main.ts");
    expect(pluginCacheBase(entry)).toBe(base);
    const cmd = launcherCommand(entry, process.execPath);
    const run = Bun.spawnSync(["sh", "-c", cmd], { stdout: "pipe", stderr: "pipe" });
    expect(new TextDecoder().decode(run.stdout).trim()).toBe("version 0.10.0 render");
  });
});
