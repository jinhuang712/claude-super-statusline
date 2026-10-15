/**
 * The mod's state contract (hooks/register.tsx): what `$.state` holds for it, so a hot reload
 * keeps the counters. `claude plugin validate` holds every state key the module names to this file.
 */

/** Token counts in the API's four buckets, summed over whatever they cover. */
export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number }

/** What the mod has counted from `turn.step` since the session started. */
export type Stats = {
  /** Every request so far, subagents' included. */
  total: Tokens
  /** The latest request alone; null before the first one. */
  last: Tokens | null
  /** Output tokens per second of the latest response long enough to measure; null until one is. */
  speed: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'super-statusline': { stats: Stats }
  }
}
