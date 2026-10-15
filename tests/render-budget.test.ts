import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../src/core/config.ts";
import { buildContext } from "../src/core/context.ts";
import { render } from "../src/core/layout.ts";
import { registerBuiltinWidgets } from "../src/widgets/index.ts";
import fixture from "../src/fixtures/basic.json";

describe("render budget", () => {
  test("default config renders the fixture well under the 300ms statusline debounce", async () => {
    registerBuiltinWidgets();
    const stdin = structuredClone(fixture) as never;
    const ctx = await buildContext(stdin, { ...DEFAULT_CONFIG, git: { enabled: false, cacheMs: 0 } }, { columns: 120, now: Date.now() });
    // warm-up
    render(DEFAULT_CONFIG, ctx);
    const started = performance.now();
    const out = render(DEFAULT_CONFIG, ctx);
    const ms = performance.now() - started;
    expect(out.errors).toEqual([]);
    expect(out.lines.length).toBeGreaterThanOrEqual(2);
    expect(ms).toBeLessThan(20);
  });

  /*
    The number that matters is the whole `render` command as Claude Code runs it: process start,
    imports, config load, context collection, layout and exit. Timing only render() (above) missed
    exactly the regressions that hurt, such as an accidental server/UI import on the hot path.
    Measured on an M-series Mac this is ~22 ms warm. The 60 ms bound leaves ~2.5× headroom for
    slower CI machines while still failing on a real regression; the median of several warm runs
    keeps a single scheduler hiccup from flaking the test.
  */
  test("the real CLI renders the fixture end to end within budget (median of warm runs)", () => {
    const root = new URL("..", import.meta.url).pathname;
    const run = () => {
      const t0 = performance.now();
      const r = Bun.spawnSync({ cmd: ["bun", "src/cli/main.ts", "render", "--fixture", "src/fixtures/basic.json"], cwd: root, env: { ...process.env, COLUMNS: "120" }, stdout: "pipe", stderr: "pipe" });
      return { ms: performance.now() - t0, code: r.exitCode, out: r.stdout.toString() };
    };
    run(); // warm the filesystem cache and Bun's transpile cache
    const runs = Array.from({ length: 7 }, run);
    for (const r of runs) {
      expect(r.code).toBe(0);
      expect(r.out).not.toContain("[claude-super-statusline] error");
      expect(r.out.trim().split("\n").length).toBeGreaterThanOrEqual(2);
    }
    const median = runs.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(runs.length / 2)]!;
    expect(median).toBeLessThan(60);
  });

  test("every builtin widget renders without throwing on the fixture and on an empty payload", async () => {
    registerBuiltinWidgets();
    const { listWidgets } = await import("../src/core/registry.ts");
    const all = listWidgets().map((w) => ({ widget: w.id }));
    for (const payload of [structuredClone(fixture), {}]) {
      const ctx = await buildContext(payload as never, { ...DEFAULT_CONFIG, git: { enabled: false, cacheMs: 0 } }, { columns: 200, now: Date.now() });
      const out = render({ ...DEFAULT_CONFIG, lines: [{ left: all }] }, ctx);
      expect(out.errors).toEqual([]);
    }
  });
});
