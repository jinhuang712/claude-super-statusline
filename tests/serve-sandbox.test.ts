/**
 * `serve --sandbox` end to end: a real server process whose "real" files are themselves a test
 * sandbox, so we can check it copies what it should, hides what it shouldn't, and never writes back.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { APP_NAME, LEGACY_APP_NAME } from "../src/data/app-name.ts";
import { enterSandbox, writeSample, type Sandbox } from "./server-sandbox.ts";

const PORT = 4891;
const BASE = `http://127.0.0.1:${PORT}`;
const MAIN = path.resolve(import.meta.dir, "..", "src", "cli", "main.ts");

let sb: Sandbox;
let proc: ReturnType<typeof Bun.spawn> | null = null;
let settingsFile: string;

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      /* not listening yet */
    }
    await Bun.sleep(50);
  }
  throw new Error("sandbox server did not start");
}

beforeAll(async () => {
  sb = enterSandbox();
  settingsFile = path.join(sb.claudeDir, "settings.json");
  fs.writeFileSync(settingsFile, JSON.stringify({ statusLine: { type: "command", command: "~/.claude/statusline.sh" }, env: { ANTHROPIC_API_KEY: "sk-secret" } }));
  fs.mkdirSync(path.dirname(sb.userConfig), { recursive: true });
  fs.writeFileSync(sb.userConfig, JSON.stringify({ separator: " real " }));
  // The "real" samples sit in a pre-0.4.0 folder: the sandbox must still find them, and must not
  // move that folder to its new name (an older install may still be the live statusline).
  writeSample(sb.claudeDir, "sess-1", { workspace: { current_dir: sb.root }, model: { display_name: "Opus 5.5" } }, Date.now(), LEGACY_APP_NAME);
  proc = Bun.spawn([process.execPath, MAIN, "serve", "--sandbox", "--port", String(PORT)], { env: { ...process.env }, stdout: "ignore", stderr: "ignore" });
  await waitForServer();
});

afterAll(() => {
  proc?.kill();
  sb.restore();
});

describe("serve --sandbox", () => {
  test("health says sandbox and every path lives under a temp root", async () => {
    const health = (await (await fetch(`${BASE}/api/health`)).json()) as { sandbox: boolean };
    expect(health.sandbox).toBe(true);
    const { paths } = (await (await fetch(`${BASE}/api/config`)).json()) as { paths: Record<string, string> };
    for (const p of Object.values(paths)) expect(p).toContain("claude-super-statusline-sandbox-");
  });

  test("it starts from copies of the real config and samples", async () => {
    const { config } = (await (await fetch(`${BASE}/api/config`)).json()) as { config: { separator: string } };
    expect(config.separator).toBe(" real ");
    const samples = (await (await fetch(`${BASE}/api/samples`)).json()) as Array<{ sessionId: string | null }>;
    expect(samples.some((s) => s.sessionId === "sess-1")).toBe(true);
  });

  test("a pre-0.4.0 data folder is read where it is, not moved", () => {
    expect(fs.existsSync(path.join(sb.claudeDir, "plugins", LEGACY_APP_NAME, "samples", "sess-1.json"))).toBe(true);
    expect(fs.existsSync(path.join(sb.claudeDir, "plugins", APP_NAME))).toBe(false);
  });

  test("only the statusLine is copied out of settings.json — no env secrets in the temp dir", async () => {
    const plan = (await (await fetch(`${BASE}/api/install`)).json()) as { settingsFile: string; current: unknown };
    expect(plan.current).toEqual({ type: "command", command: "~/.claude/statusline.sh" });
    expect(fs.readFileSync(plan.settingsFile, "utf8")).not.toContain("sk-secret");
  });

  test("writes stay in the sandbox: saves and installs don't touch the real files", async () => {
    const put = await fetch(`${BASE}/api/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope: "user", config: { separator: " sandboxed " } }) });
    expect(put.status).toBe(200);
    const inst = await fetch(`${BASE}/api/install`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmReplace: true }) });
    expect(inst.status).toBe(200);
    expect(JSON.parse(fs.readFileSync(sb.userConfig, "utf8"))).toEqual({ separator: " real " });
    expect(JSON.parse(fs.readFileSync(settingsFile, "utf8")).statusLine).toEqual({ type: "command", command: "~/.claude/statusline.sh" });
  });

  test("a project-scope save aimed at a real project is refused", async () => {
    const res = await fetch(`${BASE}/api/config?cwd=${encodeURIComponent(sb.root)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "project", config: { separator: " x " } }),
    });
    expect(res.status).toBe(403);
    expect(fs.existsSync(path.join(sb.root, ".claude", `${APP_NAME}.json`))).toBe(false);
  });
});
