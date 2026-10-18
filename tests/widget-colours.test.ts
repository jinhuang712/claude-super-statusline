import { describe, expect, test } from "bun:test";
import { createApi } from "../src/core/api.ts";
import { THEMES } from "../src/core/theme.ts";
import type { Ctx, Segment } from "../src/core/types.ts";
import { promptCache } from "../src/widgets/context.ts";
import { tokensSpeed } from "../src/widgets/tokens.ts";

/*
  The other widget tests render with colours off and compare text, so the colours a widget picks are
  pinned here, on its segments: each as [text, colour token].
*/
const NOW = Date.parse("2030-01-01T00:00:00Z");
const api = createApi(THEMES.default, NOW, "thresholds");

/** A context with only what these widgets read. */
const ctx = (extra: Record<string, unknown>) => ({ now: NOW, stdin: {}, transcript: {}, ...extra }) as unknown as Ctx;

const colours = (out: Segment[] | string | null) => (out as Segment[]).map((s) => [s.text.trim(), s.style?.fg]);

/** A warm cache with `leftMs` to go and the given hit ratio (0–1). */
const warm = (leftMs: number, hit_ratio: number) =>
  ctx({ stdin: { prompt_cache: { warm: true, caching_observed: true, ttl: "5m", expires_at: (NOW + leftMs) / 1000, hit_ratio } } });

const cache = (c: Ctx) => promptCache.render(c, { ...promptCache.defaults, showHitRatio: true }, api);

describe("context.promptCache colours", () => {
  test("the label in the accent; the dot, countdown and a good hit ratio in ok", () => {
    expect(colours(cache(warm(4 * 60_000, 0.98)))).toEqual([
      ["cache", "accent"],
      ["●", "ok"],
      ["4m", "ok"],
      ["98%", "ok"],
    ]);
  });

  test("in its last minute the dot and the countdown warn together", () => {
    expect(colours(cache(warm(30_000, 0.98))).slice(1, 3)).toEqual([
      ["●", "warn"],
      ["30s", "warn"],
    ]);
  });

  test("the hit ratio warns below 70% and is critical below 40%", () => {
    const ratio = (r: number) => colours(cache(warm(4 * 60_000, r))).at(-1);
    expect(ratio(0.71)).toEqual(["71%", "ok"]);
    expect(ratio(0.65)).toEqual(["65%", "warn"]);
    expect(ratio(0.35)).toEqual(["35%", "crit"]);
  });

  test("the hit ratio keeps its level colours under the gradient, where a good ratio would be grey", () => {
    const gradientApi = createApi(THEMES.default, NOW, "gradient");
    const out = promptCache.render(warm(4 * 60_000, 0.98), { ...promptCache.defaults, showHitRatio: true }, gradientApi);
    expect(colours(out).at(-1)).toEqual(["98%", "ok"]);
  });

  test("a cold cache stays muted: nothing is alive to colour", () => {
    const cold = ctx({ stdin: { prompt_cache: { warm: false, caching_observed: true, hit_ratio: null } } });
    expect(colours(cache(cold))).toEqual([
      ["cache", "accent"],
      ["○ cold", "muted"],
    ]);
  });

  test("the transcript fallback (older Claude Code) colours the countdown like the dot", () => {
    const old = ctx({ transcript: { promptCacheAnchorAt: new Date(NOW - 60_000), promptCacheTtlSeconds: 300 } });
    expect(colours(cache(old))).toEqual([
      ["cache", "accent"],
      ["●", "ok"],
      ["4m", "ok"],
    ]);
  });
});

describe("tokens.outputSpeed colour", () => {
  test("the speed is in the usage colour", () => {
    expect(colours(tokensSpeed.render(ctx({ responseSpeed: { tokensPerSecond: 80 } }), tokensSpeed.defaults, api))).toEqual([["80 tok/s", "usage"]]);
  });
});
