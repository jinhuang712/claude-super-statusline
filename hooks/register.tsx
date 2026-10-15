/**
 * super-statusline as a mod: the same widgets, drawn in the band above the prompt on every surface
 * that raises `AbovePrompt` (the terminal and the desktop app). The CLI's own `statusLine` command
 * (src/cli) is untouched and keeps working beside it.
 *
 * A mod runs without Node, so it cannot read Claude Code's stdin payload. `snapshot` rebuilds the
 * fields the widgets read from `$.session`, and the widgets run unchanged. What `$.session` does not
 * report (token totals, cache hit ratio, output speed) the mod counts itself from `turn.step`.
 */
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { createApi } from '../src/core/api.ts'
import { THEMES } from '../src/core/theme.ts'
import { defineWidget } from '../src/core/types.ts'
import type { Ctx, LineConfig, Segment, WidgetDefinition, WidgetInstance } from '../src/core/types.ts'
import { DEFAULT_DESKTOP_LINES, readDesktopLines } from '../src/core/desktop.ts'
import { withLabel } from '../src/widgets/_shared.ts'
import { usageSingle, usageWindows } from '../src/widgets/usage.ts'
import type { Stats, Tokens } from '../types'

/** What the mod has counted since this session started (kept in `$.state`, so a reload keeps it). */
const stats = atom({ plugin: 'super-statusline', key: 'stats' } as const, {
  total: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  last: null,
  speed: null,
} as Stats)

/** A context's usual shape plus what the mod counted; the widgets below read `ctx.stats`. */
type ModCtx = Ctx & { stats: Stats }

/**
 * Below this many output tokens the time to first token dominates and the figure says more about
 * latency than speed, so the last reading is kept instead. Same cut-off as tokens.outputSpeed.
 */
const MIN_SPEED_TOKENS = 200

/** Share of a response's prompt the cache served, 0–1; null before any input was seen. */
const hitRatio = (t: Tokens) => {
  const prompt = t.input + t.cacheRead + t.cacheWrite
  return prompt > 0 ? t.cacheRead / prompt : null
}

// The desktop app already shows the model, the context ring and the project, so the band carries only
// what it lacks. The built-in cost.session and tokens.* widgets read node:fs, which a mod cannot
// import, so the widgets below are small stand-ins fed by what the mod counted.
type Labelled = { label: string | null }

const cost = defineWidget<Labelled>({
  id: 'cost.session',
  name: 'Session cost',
  description: 'What the session has cost so far.',
  category: 'cost',
  schema: { type: 'object', properties: {} },
  defaults: { label: 'Cost' },
  render(ctx, o, api) {
    const usd = ctx.stdin.cost?.total_cost_usd
    if (usd == null) return null
    const label = withLabel(o.label, 'Cost')
    return [...(label ? [api.seg(`${label} `, { fg: 'muted' })] : []), api.seg(usd < 0.005 ? '$0.00' : `$${usd.toFixed(2)}`)]
  },
})

// Takes the registry's context.promptCache id so a layout written for the terminal names the same
// widget; here it shows the hit ratio, since warm/cold and the expiry are not something a mod sees.
const cache = defineWidget<Labelled>({
  id: 'context.promptCache',
  name: 'Cache hit ratio',
  description: 'Share of the latest response’s prompt the prompt cache served, and the session average.',
  category: 'context',
  schema: { type: 'object', properties: {} },
  defaults: { label: 'Cache' },
  render(ctx, o, api) {
    const { last, total } = (ctx as ModCtx).stats
    const now = last && hitRatio(last)
    if (now == null) return null
    // A high hit ratio is the good end, so the level is taken on the miss share.
    const pct = Math.round(now * 100)
    const lvl = api.level(100 - pct, 30, 60)
    const avg = hitRatio(total)
    const label = withLabel(o.label, 'Cache')
    return [
      ...(label ? [api.seg(`${label} `, { fg: 'muted' })] : []),
      api.seg(`${pct}%`, { fg: api.levelColor(100 - pct, lvl, 'ok') }),
      ...(avg == null ? [] : [api.seg(` avg ${Math.round(avg * 100)}%`, { fg: 'muted' })]),
    ]
  },
})

const tokens = defineWidget<Labelled>({
  id: 'tokens.session',
  name: 'Session tokens',
  description: 'Tokens used since the mod started counting: new input, output and cache reads.',
  category: 'usage',
  schema: { type: 'object', properties: {} },
  defaults: { label: 'Tokens' },
  render(ctx, o, api) {
    const t = (ctx as ModCtx).stats.total
    const all = t.input + t.output + t.cacheRead + t.cacheWrite
    if (all <= 0) return null
    const label = withLabel(o.label, 'Tokens')
    return [
      ...(label ? [api.seg(`${label} `, { fg: 'muted' })] : []),
      api.seg(api.tokens(all)),
      api.seg(` ↓${api.tokens(t.input + t.cacheWrite)} ↑${api.tokens(t.output)}`, { fg: 'muted' }),
    ]
  },
})

const speed = defineWidget<Record<string, never>>({
  id: 'tokens.outputSpeed',
  name: 'Output speed',
  description: 'Output tokens per second of the latest long-enough response, end to end.',
  category: 'usage',
  schema: { type: 'object', properties: {} },
  defaults: {},
  render(ctx, _o, api) {
    const tps = (ctx as ModCtx).stats.speed
    if (tps == null || !Number.isFinite(tps)) return null
    return [api.seg(`${tps.toFixed(tps < 10 ? 1 : 0)} tok/s`, { fg: 'muted' })]
  },
})

/** Widgets by registry id: the real ones where they run in a mod, the stand-ins above elsewhere. */
const WIDGETS: Record<string, WidgetDefinition<any>> = {
  'usage.windows': usageWindows,
  'usage.single': usageSingle,
  'cost.session': cost,
  'context.promptCache': cache,
  'tokens.session': tokens,
  'tokens.outputSpeed': speed,
}

type Instance = { def: WidgetDefinition<any>; options?: Record<string, unknown> }
type Line = { left: Instance[]; right: Instance[] }

/** A config entry as something drawable: its widget, with the entry's label laid over the options. */
const toInstance = (w: WidgetInstance): Instance[] => {
  const def = WIDGETS[w.widget]
  if (!def) return []
  return [{ def, options: w.label === undefined ? w.options : { ...w.options, label: w.label } }]
}

const toLines = (lines: LineConfig[]): Line[] =>
  lines.map(l => ({ left: (l.left ?? []).flatMap(toInstance), right: (l.right ?? []).flatMap(toInstance) }))

const theme = THEMES.default!

type Files = {
  env: { get: (name: string) => Promise<string | undefined> }
  fs: { stat: (path: string) => Promise<{ mtimeMs: number }>; read: (path: string) => Promise<string | { base64: string }> }
}

/** Folder names the config has lived under, newest first (src/data/app-name.ts has the same list; a mod cannot import it). */
const CONFIG_DIRS = ['claude-super-statusline', 'claude-code-super-statusline', 'claude-code-ssp']

/**
 * The config file the web panel writes, found the way src/core/config.ts's userConfigPath finds it. The
 * file may still sit under an earlier product name: the statusline moves the folder the first time it
 * runs after an upgrade, and a mod can only read, so it takes the first name that has the file.
 */
const configPath = async ($: Files) => {
  const explicit = (await $.env.get('CLAUDE_SUPER_STATUSLINE_CONFIG'))?.trim() || (await $.env.get('CLAUDE_CODE_SUPER_STATUSLINE_CONFIG'))?.trim()
  if (explicit) return explicit
  const xdg = (await $.env.get('XDG_CONFIG_HOME'))?.trim()
  const home = await $.env.get('HOME')
  const base = xdg || `${home}/.config`
  for (const dir of CONFIG_DIRS) {
    const candidate = `${base}/${dir}/config.json`
    if (await $.fs.stat(candidate).then(() => true, () => false)) return candidate
  }
  return `${base}/${CONFIG_DIRS[0]}/config.json`
}

/** The layout last read, with the file's modification time, so an unchanged file is not parsed again. */
let loaded: { path: string; mtimeMs: number; lines: LineConfig[] } | null = null

/**
 * The desktop layout the user saved in the panel (`desktop.lines`), or the default one. A missing,
 * unreadable or malformed file falls back to the default rather than blanking the band: the band is
 * decoration, and the panel may be mid-write or never have been opened.
 */
const loadLines = async ($: Files): Promise<LineConfig[]> => {
  try {
    const path = await configPath($)
    const { mtimeMs } = await $.fs.stat(path)
    if (loaded?.path === path && loaded.mtimeMs === mtimeMs) return loaded.lines
    const text = await $.fs.read(path)
    const lines = readDesktopLines(JSON.parse(typeof text === 'string' ? text : ''))
    loaded = { path, mtimeMs, lines }
    return lines
  } catch {
    return DEFAULT_DESKTOP_LINES
  }
}

const seconds = (iso: string | undefined) => (iso ? Math.floor(Date.parse(iso) / 1000) : null)

type Session = {
  session: { usage: () => Promise<any> }
  clock: { now: () => Promise<number> }
}

const snapshot = async ($: Session, counted: Stats): Promise<ModCtx> => {
  const [usage, now] = await Promise.all([$.session.usage(), $.clock.now()])
  const window = (kind: string) => usage.rateLimits.find((r: { kind: string }) => r.kind === kind)

  const five = window('five_hour')
  const seven = window('seven_day')

  return {
    columns: 120,
    now,
    theme,
    colorMode: 'thresholds',
    reset: null,
    stats: counted,
    stdin: {
      cost: usage.cost ? { total_cost_usd: usage.cost.usd } : null,
      rate_limits: {
        five_hour: five ? { used_percentage: five.percentUsed, resets_at: seconds(five.resetsAt) } : null,
        seven_day: seven ? { used_percentage: seven.percentUsed, resets_at: seconds(seven.resetsAt) } : null,
      },
    },
    transcript: { sessionTokens: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 } },
  } as unknown as ModCtx
}

const renderInstance = (inst: Instance, ctx: Ctx): Segment[] => {
  try {
    const api = createApi(ctx.theme, ctx.now, ctx.colorMode)
    const out = inst.def.render(ctx, { ...inst.def.defaults, ...inst.options }, api)
    return typeof out === 'string' ? [{ text: out }] : (out ?? [])
  } catch {
    // A widget that throws must not blank the band; it shows its id instead, as the CLI does.
    return [{ text: `⚠ ${inst.def.id}`, style: { fg: 'muted', dim: true } }]
  }
}

/**
 * The terminal's ANSI colour names as hex. The widgets and themes colour with those names (`brightBlue`
 * is the default theme's `usage` token), but the desktop app only knows its own theme keys and CSS
 * colours: given `brightBlue` it drew nothing, so the filled part of a bar became a transparent gap.
 * Mid-tones, so they read on a light and a dark ground alike.
 */
const ANSI_HEX: Record<string, string> = {
  black: '#555555',
  red: '#e5484d',
  green: '#3fa34d',
  yellow: '#e6b800',
  blue: '#4f8ff7',
  magenta: '#c05ccf',
  cyan: '#2bb5c4',
  white: '#d4d4d4',
  gray: '#8a8a8a',
  grey: '#8a8a8a',
  brightBlack: '#8a8a8a',
  brightRed: '#ff6b6b',
  brightGreen: '#5fd16f',
  brightYellow: '#ffd43b',
  brightBlue: '#6ea8ff',
  brightMagenta: '#e089f0',
  brightCyan: '#5fdce8',
  brightWhite: '#f2f2f2',
}

/** A segment's colour as the band can draw it: a theme token resolved, an ANSI name as hex, `default` as none. */
const colorOf = (fg: string | undefined) => {
  if (!fg || fg === 'default') return undefined
  const resolved = theme.tokens[fg] ?? fg
  if (resolved === 'default') return undefined
  return ANSI_HEX[resolved] ?? resolved
}

/**
 * A widget's text bar ("███░░░") is a run of filled then empty glyphs. The terminal draws those fine,
 * but the desktop app renders each glyph as a chunky cell with a dotted empty part, so a bar that
 * matches is drawn as two background-coloured boxes of the same width instead. Either run may be
 * empty: a window that just reset has an all-empty bar, a full one has no empty part. An empty
 * string matches too, so the callers below check that something was matched.
 */
const BAR = /^(█*)(░*)$/

export const register: Register = on => {
  on('session.measure', ($, e, next) => {
    $.ui.invalidate('ui.render')
    return next(e)
  })

  // One model request. Counted when it ends: its token counts come with the stop, and the time from
  // here to there is the response's end-to-end duration (time to first token included).
  on('turn.step', async function* ($, e, next) {
    const startedAt = await $.clock.now()
    const result = yield* next(e)
    const usage = result?.usage
    if (!usage) return

    const ms = (await $.clock.now()) - startedAt
    const t: Tokens = {
      input: usage.input_tokens,
      output: usage.output_tokens,
      cacheRead: usage.cache_read_input_tokens,
      cacheWrite: usage.cache_creation_input_tokens,
    }

    await update($, stats, s => ({
      total: {
        input: s.total.input + t.input,
        output: s.total.output + t.output,
        cacheRead: s.total.cacheRead + t.cacheRead,
        cacheWrite: s.total.cacheWrite + t.cacheWrite,
      },
      last: t,
      speed: t.output >= MIN_SPEED_TOKENS && ms > 0 ? t.output / (ms / 1000) : s.speed,
    }))
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const ctx = await snapshot($, await read($, stats))
    const lines = toLines(await loadLines($))
    if (lines.every(l => l.left.length + l.right.length === 0)) return next(e)
    const { Box, Text } = $.ui.resolve(e)

    // One box per widget, never shrunk: a pane too narrow for a row moves whole widgets to the next row
    // instead of breaking their text mid-phrase (a split view, a small window). Widgets are spaced by a
    // gap rather than a separator glyph, which would be left dangling at the end of a wrapped row.
    const widget = (inst: Instance, i: number) => {
      const segs = renderInstance(inst, ctx)
      if (segs.length === 0) return []
      return [
        <Box key={`${inst.def.id}${i}`} flexShrink={0}>
          {segs.map((s, j) => {
            const bar = BAR.exec(s.text.trim())
            if (bar && bar[0].length > 0) {
              return (
                <Box key={`${inst.def.id}${j}`} marginX={1} flexShrink={0}>
                  <Box width={bar[1]!.length} flexShrink={0} backgroundColor={colorOf(s.style?.fg) ?? 'success'}>
                    <Text> </Text>
                  </Box>
                  <Box width={bar[2]!.length} flexShrink={0} backgroundColor="subtle">
                    <Text> </Text>
                  </Box>
                </Box>
              )
            }
            return (
              <Text key={`${inst.def.id}${j}`} color={colorOf(s.style?.fg)} bold={s.style?.bold} dimColor={s.style?.dim}>
                {s.text}
              </Text>
            )
          })}
        </Box>,
      ]
    }

    return (
      <Box flexDirection="column" overflow="hidden">
        {lines.map((line, i) => (
          <Box key={`line${i}`} flexWrap="wrap" columnGap={3}>
            <Box flexWrap="wrap" columnGap={3}>
              {line.left.flatMap(widget)}
            </Box>
            {/* Grows to fill the row, so on a row of its own it still sits at the right edge. */}
            <Box flexGrow={1} flexWrap="wrap" justifyContent="flex-end" columnGap={3}>
              {line.right.flatMap(widget)}
            </Box>
          </Box>
        ))}
      </Box>
    )
  })
}
