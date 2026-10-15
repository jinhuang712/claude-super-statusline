/**
 * Smoke test for the mod (run with `scripts/test-mod.sh`, not `bun test`: it imports the plugin
 * test kit, which only exists inside `claude plugin test`). The band must draw on both surfaces that raise
 * AbovePrompt, with no session data yet: that is the state a fresh session is in.
 */
import type { RenderElement } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

describe('super-statusline band', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`draws on the ${surface} surface`, async ($, on) => {
      // Nothing sits beneath the plugins in a test, so something must answer ui.render for the engine.
      mock.clock(on)
      on('ui.render', ($, e) => h($.ui.resolve(e).Text, {}, 'engine default') as RenderElement)

      const drawing = await $.ui.mount({
        plugin: 'super-statusline',
        surface,
        component: 'AbovePrompt',
        // The band reads only hasSurvey; the sizes and scroll state the engine also sends are irrelevant here.
        props: { hasSurvey: false } as never,
      })
      expect(drawing).toBeDefined()
    })
  }
})
