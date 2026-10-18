import type { StdinData } from "../data/types.js";
import type { Color, Ctx, JsonSchema, WidgetApi } from "../core/types.js";

/** Fields Claude Code ≥ 2.1.251 sends that the harvested StdinData type does not declare yet. */
export interface StdinExtras {
  session_name?: string;
  version?: string;
  output_style?: { name?: string } | null;
  fast_mode?: boolean;
  thinking?: { enabled?: boolean } | null;
  vim?: { mode?: string } | null;
  agent?: { name?: string } | null;
  exceeds_200k_tokens?: boolean;
  prompt_cache?: {
    warm?: boolean;
    caching_observed?: boolean;
    ttl?: string;
    expires_at?: number | null;
    requests?: number;
    misses?: number;
    hit_ratio?: number | null;
    /** Tokens written to the cache by the requests counted as misses. */
    miss_recache_tokens?: number;
    /** Likely cause of the last miss (≥ 2.1.260); null until the first one, or when unknown. */
    last_miss_cause?: { causes?: string[] } | null;
    /** Tokens the next request re-caches if the cache has gone cold by then; null right after a compaction. */
    recache_tokens_if_cold?: number | null;
  } | null;
  pr?: { number?: number; url?: string; review_state?: string; kind?: string } | null;
  worktree?: { name?: string; path?: string; branch?: string; original_cwd?: string; original_branch?: string } | null;
  workspace?: StdinData["workspace"] & {
    repo?: { host?: string; owner?: string; name?: string } | null;
  };
  rate_limits?: StdinData["rate_limits"] & {
    spend_limit?: { used_percentage?: number; resets_at?: number } | null;
  };
}

export type Stdin = StdinData & StdinExtras;

export function stdin(ctx: Ctx): Stdin {
  return ctx.stdin as Stdin;
}

export const labelSchema: JsonSchema = {
  type: ["string", "null"],
  title: "Label",
  description: "Text shown before the value. Empty hides the label.",
  default: null,
};

export function withLabel(label: string | null | undefined, fallback: string): string | null {
  if (label === undefined) return fallback;
  if (label === null || label === "") return null;
  return label;
}

/**
 * The text to put in front of a value for `label`. Symbol labels hug the value ("⟳2") and so do
 * assignment-style ones ("AWS_PROFILE=prod"); word labels get a space ("Compacted 2"). Without
 * this, a custom text label ran straight into the number ("Compacted2").
 */
export function labelPrefix(label: string | null): string {
  if (!label) return "";
  // ≤ 2 UTF-16 units covers a BMP symbol (⟳) or one astral emoji; letters/digits make it a word.
  const glyph = label.length <= 2 && !/[\p{L}\p{N}]/u.test(label);
  return glyph || label.endsWith("=") ? label : `${label} `;
}

/**
 * The two thresholds of a percentage widget. The colour mode itself is config-wide (`colorMode`,
 * the panel's "Progress bar mode"; widgets colour through `api.levelColor`). Under the gradient the
 * colour comes from the percentage alone, so warnAt does nothing (x-requires-config tells the panel
 * to dim it). critAt usually still matters: widgets that bold the value at the critical level keep
 * doing so under the gradient — pass `critBolds: false` for one that doesn't, and critAt gets the
 * same requirement.
 */
export function thresholdSchema(warn: number, crit: number, opts: { critBolds?: boolean } = {}): Record<string, JsonSchema> {
  const thresholdsOnly = { "x-requires-config": { colorMode: "thresholds" } };
  return {
    warnAt: { type: "integer", title: "Warn at %", minimum: 0, maximum: 100, default: warn, ...thresholdsOnly },
    critAt: { type: "integer", title: "Critical at %", minimum: 0, maximum: 100, default: crit, ...(opts.critBolds === false ? thresholdsOnly : {}) },
  };
}

/**
 * The colour of a prompt-cache hit ratio (0–100), for the statusline and the desktop band alike. A
 * high ratio is the good end, so the level is taken on the miss share: below 70% served from the
 * cache it warns, below 40% it is critical.
 *
 * Always the ok / warn / crit tokens, even under `colorMode: "gradient"`: the gradient runs from grey
 * at 0% used to red at 100%, so a healthy 1–2% miss share would be drawn grey, as if uncoloured.
 */
export function hitRatioColor(api: WidgetApi, pct: number): Color {
  return api.level(100 - pct, 30, 60);
}

/**
 * Short model name for an agent: the Agent tool's `model` is either an alias ("opus") or, for
 * forks and inherited models, a full id like "claude-opus-5-5[1m]" — too long and noisy for a
 * statusline. Full ids become "opus 5.5"; anything unrecognised is shown as given, minus the
 * "claude-" prefix and a "[1m]"-style suffix.
 */
export function shortModelName(model: string): string {
  const m = model
    .trim()
    .toLowerCase()
    .replace(/^claude-/, "")
    .replace(/\[[^\]]*\]$/, "")
    .replace(/-\d{8}$/, ""); // date-stamped ids (…-20250514)
  let x = /^([a-z]+)-(\d+)-(\d+)$/.exec(m); // opus-5-5
  if (x) return `${x[1]} ${x[2]}.${x[3]}`;
  x = /^([a-z]+)-(\d+)$/.exec(m); // opus-5
  if (x) return `${x[1]} ${x[2]}`;
  x = /^(\d+)-(\d+)-([a-z]+)$/.exec(m); // 3-5-sonnet (older ids)
  if (x) return `${x[3]} ${x[1]}.${x[2]}`;
  return m || model;
}
