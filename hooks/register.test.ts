/**
 * Tests for the mod (run with `scripts/test-mod.sh`, not `bun test`: it imports the plugin test kit,
 * which only exists inside `claude plugin test`). The band must draw in the desktop app, in a fresh
 * session with nothing to show yet, and with data at a wide and a very narrow width: a split view or a
 * small window must move whole widgets to another row, not lose them. In the terminal, which has the
 * statusline under the prompt, it must leave the engine's own drawing in place.
 */
import type { On, RenderElement } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

/**
 * Stands in for the engine under the plugin: a clock, a `ui.render` answer (nothing sits beneath the
 * plugins in a test, and a hook with no answer beneath it is skipped, not run), and what
 * `$.session.usage()` reports.
 */
function engine(on: On, usage: { rateLimits: unknown[]; cost?: { usd: number } }) {
  mock.clock(on)
  on('ui.render', ($, e) => h($.ui.resolve(e).Text, {}, 'engine default') as RenderElement)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, tokens: 0, percent: 0 }, ...usage } }) as never)
}

const mountBand = ($: Parameters<Parameters<typeof test>[1]>[0], surface: 'terminal' | 'desktop', bodyColumns = 120) =>
  $.ui.mount({
    plugin: 'super-statusline',
    surface,
    component: 'AbovePrompt',
    // The band reads only hasSurvey; the rest of what the engine sends (sizes, scroll state) is irrelevant here.
    props: { hasSurvey: false, bodyColumns } as never,
  })

describe('super-statusline band', () => {
  test("draws in the desktop app before there is anything to show", async ($, on) => {
    engine(on, { rateLimits: [] });
    const drawing = await mountBand($, "desktop");
    expect(drawing).toBeDefined();
  });

  test("leaves the terminal to the engine, even with something to show", async ($, on) => {
    engine(on, { rateLimits: [{ kind: "five_hour", percentUsed: 61, resetsAt: "2030-01-01T05:00:00Z" }], cost: { usd: 2.73 } });
    const drawing = await mountBand($, "terminal");
    expect(await drawing.findAll({ type: "Text", text: /engine default/ })).toHaveLength(1);
    expect(await drawing.findAll({ type: "Text", text: /61%|\$2\.73/ })).toHaveLength(0);
  });

  for (const bodyColumns of [24, 160]) {
    test(`keeps every widget at ${bodyColumns} columns`, async ($, on) => {
      // A 5-hour window at 61% and a session that has cost $2.73.
      engine(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 61, resetsAt: '2030-01-01T05:00:00Z' }], cost: { usd: 2.73 } })
      const drawing = await mountBand($, 'desktop', bodyColumns)
      // The default layout has the rate-limit window on the left and the cost on the right.
      expect((await drawing.findAll({ type: 'Text', text: /61%/ })).length).toBeGreaterThan(0)
      expect((await drawing.findAll({ type: 'Text', text: /\$2\.73/ })).length).toBeGreaterThan(0)
    })
  }

  test("colours the cache and the speed as the statusline does", async ($, on) => {
    engine(on, { rateLimits: [] });
    // A response whose prompt the cache served 98% of (980 of 1000 tokens), at 80 tokens a second,
    // answered as what the band counted: the test's hooks sit beneath it, so it reads this.
    const last = { input: 10, output: 400, cacheRead: 980, cacheWrite: 10 };
    on("state.get", { plugin: "super-statusline", key: "stats" }, () => ({ value: { value: { total: last, last, speed: 80 }, version: 1 } }) as never);
    const drawing = await mountBand($, "desktop");
    const color = async (text: RegExp) => (await drawing.find({ type: "Text", text }))?.props.color;
    // The default theme's tokens, as the band draws them (ANSI names as hex).
    expect(await color(/^Cache $/)).toBe("#2bb5c4"); // accent: cyan
    expect(await color(/^98%$/)).toBe("#3fa34d"); // ok: green
    expect(await color(/tok\/s/)).toBe("#6ea8ff"); // usage: brightBlue
  });
})
