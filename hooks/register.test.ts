/**
 * Tests for the mod (run with `scripts/test-mod.sh`, not `bun test`: it imports the plugin test kit,
 * which only exists inside `claude plugin test`). The band must draw on both surfaces that raise
 * AbovePrompt, in a fresh session with nothing to show yet, and with data at a wide and a very narrow
 * width: a split view or a small window must move whole widgets to another row, not lose them.
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
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`draws on the ${surface} surface before there is anything to show`, async ($, on) => {
      engine(on, { rateLimits: [] })
      const drawing = await mountBand($, surface)
      expect(drawing).toBeDefined()
    })
  }

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
})
