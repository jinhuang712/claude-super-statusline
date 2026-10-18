import { defineWidget } from "../core/types.js";
import { getContextPercent, getTotalTokens } from "../data/stdin.js";
import { formatTokens } from "../core/api.js";
import { sanitizeDisplayText } from "../data/utils/sanitize.js";
import { hitRatioColor, labelPrefix, labelSchema, stdin, thresholdSchema, withLabel } from "./_shared.js";

type ValueMode = "percent" | "tokens" | "remaining" | "both";

function valueText(ctx: Parameters<typeof getContextPercent>[0], pct: number, mode: ValueMode): string {
  const size = ctx.context_window?.context_window_size ?? 200_000;
  const used = getTotalTokens(ctx);
  switch (mode) {
    case "tokens":
      return `${formatTokens(used)}/${formatTokens(size)}`;
    case "remaining":
      return `${Math.max(0, 100 - pct)}% left`;
    case "both":
      return `${pct}% (${formatTokens(used)}/${formatTokens(size)})`;
    default:
      return `${pct}%`;
  }
}

export const contextBar = defineWidget<{ label: string | null; showBar: boolean; showTokens: boolean; width: number; value: ValueMode; warnAt: number; critAt: number; autoCompactWindow: number | null }>({
  // The id stays context.bar (configs name it); the name says what it shows — usage, with or without
  // the bar — now that it also stands in for the text-only context widgets.
  id: "context.bar",
  name: "Context usage",
  description: "Context window usage: a bar, the percentage and, if you like, the tokens used.",
  category: "context",
  sample: "Context ███░░░░░░░ 32%",
  schema: {
    type: "object",
    properties: {
      label: { ...labelSchema, default: "Context" },
      showTokens: { type: "boolean", default: false, title: "Show used/total tokens (400k/1M)" },
      showBar: { type: "boolean", default: true, title: "Show bar" },
      width: { type: "integer", default: 10, minimum: 3, maximum: 40, title: "Bar width", "x-requires": { showBar: true } },
      value: { type: "string", enum: ["percent", "remaining"], default: "percent", title: "Percentage shows" },
      ...thresholdSchema(70, 85),
      autoCompactWindow: { type: ["integer", "null"], default: null, title: "Autocompact window (tokens)", description: "Compute % against this window instead of the full model window, to match /context." },
    },
  },
  defaults: { label: "Context", showBar: true, showTokens: false, width: 10, value: "percent", warnAt: 70, critAt: 85, autoCompactWindow: null },
  numeric: (ctx, o) => getContextPercent(ctx.stdin, o.autoCompactWindow),
  render(ctx, o, api) {
    const s = stdin(ctx);
    if (!s.context_window) return null;
    const pct = getContextPercent(s, o.autoCompactWindow);
    const lvl = api.level(pct, o.warnAt, o.critAt);
    const label = withLabel(o.label, "Context");
    const segs = [];
    const valueStyle = { fg: api.levelColor(pct, lvl, "fg"), bold: lvl === "crit" } as const;
    const barColor = api.levelColor(pct, lvl, "context");
    if (label) segs.push(api.seg(`${label} `, { fg: "muted" }));
    // Composition: [tokens] [bar] percent — with no bar the percent goes in parentheses after the tokens.
    const pctText = valueText(s, pct, o.value === "remaining" ? "remaining" : "percent");
    if (o.showTokens) segs.push(api.seg(`${valueText(s, pct, "tokens")}${o.showBar ? " " : ""}`, { fg: o.showBar ? "muted" : "fg" }));
    if (o.showBar) segs.push(api.seg(api.bar(pct, o.width), { fg: barColor }));
    if (o.showBar) segs.push(api.seg(` ${pctText}`, valueStyle));
    else segs.push(api.seg(o.showTokens ? ` (${pctText})` : pctText, valueStyle));
    return segs;
  },
});

export const contextPercent = defineWidget<{ label: string | null; value: ValueMode; warnAt: number; critAt: number }>({
  id: "context.value",
  name: "Context value",
  description: "Context usage as text only (no bar).",
  category: "context",
  sample: "ctx 32%",
  schema: {
    type: "object",
    properties: {
      label: { ...labelSchema, default: "ctx" },
      value: { type: "string", enum: ["percent", "tokens", "remaining", "both"], default: "percent" },
      // Text only, never bold: under the gradient neither threshold changes anything.
      ...thresholdSchema(70, 85, { critBolds: false }),
    },
  },
  defaults: { label: "ctx", value: "percent", warnAt: 70, critAt: 85 },
  numeric: (ctx) => getContextPercent(ctx.stdin),
  render(ctx, o, api) {
    const s = stdin(ctx);
    if (!s.context_window) return null;
    const pct = getContextPercent(s);
    const lvl = api.level(pct, o.warnAt, o.critAt);
    const label = withLabel(o.label, "ctx");
    return [...(label ? [api.seg(`${label} `, { fg: "muted" })] : []), api.seg(valueText(s, pct, o.value), { fg: api.levelColor(pct, lvl, "fg") })];
  },
});

/*
  Claude Code's exceeds_200k_tokens: input, cache and output of the last response together passed
  200k. The line is fixed, whatever the window size, so on a 1M window it fires long before the
  context bar looks full — which is exactly when it is worth a glance.
*/
export const over200k = defineWidget<{ label: string | null }>({
  id: "context.over200k",
  name: "Over 200k tokens",
  description: "A flag while the last request carried more than 200k tokens (input, cache and output together), whatever the window size.",
  category: "context",
  sample: "200k+",
  schema: { type: "object", properties: { label: { ...labelSchema, default: null } } },
  defaults: { label: null },
  render(ctx, o, api) {
    if (stdin(ctx).exceeds_200k_tokens !== true) return null;
    const label = withLabel(o.label, "");
    return [...(label ? [api.seg(`${label} `, { fg: "muted" })] : []), api.seg("200k+", { fg: "warn" })];
  },
});

export const contextCompactions = defineWidget<{ label: string | null }>({
  id: "context.compactions",
  name: "Compactions",
  description: "Number of /compact or auto-compact events this session (hidden until the first one).",
  category: "context",
  sample: "⟳2",
  schema: { type: "object", properties: { label: { ...labelSchema, default: "⟳" } } },
  defaults: { label: "⟳" },
  render(ctx, o, api) {
    const n = ctx.transcript.compactionCount ?? 0;
    if (n <= 0) return null;
    return [api.seg(`${labelPrefix(withLabel(o.label, "⟳"))}${n}`, { fg: "muted" })];
  },
});

/**
 * The colour of a warm cache's dot and countdown: `ok`, or `warn` in its last minute, when the next
 * request may already find it cold.
 */
const aliveColor = (remainingMs: number) => (remainingMs < 60_000 ? "warn" : "ok");

export const promptCache = defineWidget<{ label: string | null; showHitRatio: boolean; showTtl: boolean; showRecache: boolean }>({
  id: "context.promptCache",
  name: "Prompt cache",
  description: "Whether the prompt cache is warm and when it expires.",
  category: "context",
  sample: "cache ● 42m",
  schema: {
    type: "object",
    properties: {
      label: { ...labelSchema, default: "cache" },
      showHitRatio: { type: "boolean", default: false, title: "Show hit ratio" },
      showTtl: { type: "boolean", default: false, title: "Show the cache lifetime (42m/1h)" },
      showRecache: { type: "boolean", default: false, title: "What a cold cache would re-cache (↻45k)" },
    },
  },
  defaults: { label: "cache", showHitRatio: false, showTtl: false, showRecache: false },
  render(ctx, o, api) {
    const pc = stdin(ctx).prompt_cache;
    const label = withLabel(o.label, "cache");
    // The label is in the accent, not muted like most labels, so the cache reads apart from the context
    // figures beside it.
    const segs = label ? [api.seg(`${label} `, { fg: "accent" })] : [];
    if (pc) {
      if (!pc.caching_observed) return null;
      if (pc.warm && pc.expires_at) {
        const remaining = pc.expires_at * 1000 - ctx.now;
        const alive = aliveColor(remaining);
        segs.push(api.seg("●", { fg: alive }), api.seg(` ${api.duration(Math.max(0, remaining))}`, { fg: alive }));
        // The lifetime the countdown runs down from ("5m" or "1h"), only meaningful while warm.
        if (o.showTtl && pc.ttl) segs.push(api.seg(`/${sanitizeDisplayText(pc.ttl)}`, { fg: "muted" }));
      } else {
        segs.push(api.seg("○ cold", { fg: "muted" }));
      }
      if (o.showHitRatio && typeof pc.hit_ratio === "number") {
        const pct = Math.round(pc.hit_ratio * 100);
        segs.push(api.seg(` ${pct}%`, { fg: hitRatioColor(api, pct) }));
      }
      // recache_tokens_if_cold: what the next request pays to rebuild the cache if it has gone cold by
      // then — the cost of stepping away. null right after a compaction, until the next request.
      if (o.showRecache && typeof pc.recache_tokens_if_cold === "number") segs.push(api.seg(` ↻${api.tokens(pc.recache_tokens_if_cold)}`, { fg: "muted" }));
      return segs;
    }
    // Fallback: transcript-derived anchor (older Claude Code).
    const anchor = ctx.transcript.promptCacheAnchorAt;
    if (!anchor) return null;
    const ttl = (ctx.transcript.promptCacheTtlSeconds ?? 300) * 1000;
    const remaining = anchor.getTime() + ttl - ctx.now;
    if (remaining <= 0) return [...segs, api.seg("○ cold", { fg: "muted" })];
    const alive = aliveColor(remaining);
    return [...segs, api.seg("●", { fg: alive }), api.seg(` ${api.duration(remaining)}`, { fg: alive })];
  },
});

/**
 * Plain words for prompt_cache.last_miss_cause names. The docs give these as examples, not a closed
 * list, so any other name is shown with its underscores as spaces.
 */
const MISS_CAUSES: Record<string, string> = {
  tools_changed: "tools changed",
  system_prompt_changed: "system prompt changed",
  ttl_expired_5m: "5m TTL expired",
  likely_server_side: "server side",
};

/*
  prompt_cache misses: requests that re-processed what the cache already held (Claude Code counts
  one when > 5% and ≥ 2k tokens of what could have been read from cache wasn't, with no compaction
  to explain it). Each one costs a full re-cache, so the count and its likely cause are the part of
  the cache story worth a glance; warm/cold and the hit ratio stay with Prompt cache.
*/
export const cacheMisses = defineWidget<{ label: string | null; showRequests: boolean; showCause: boolean; showRecached: boolean; hideZero: boolean }>({
  id: "context.cacheMisses",
  name: "Cache misses",
  description: "Prompt cache misses this session, out of all requests, with the likely cause of the last one.",
  category: "context",
  sample: "miss 2/14 (tools changed)",
  schema: {
    type: "object",
    properties: {
      label: { ...labelSchema, default: "miss" },
      showRequests: { type: "boolean", default: true, title: "Out of all requests (2/14)" },
      showCause: { type: "boolean", default: true, title: "Likely cause of the last miss" },
      showRecached: { type: "boolean", default: false, title: "Tokens the misses re-cached (+310k)" },
      hideZero: { type: "boolean", default: true, title: "Hide while there are no misses" },
    },
  },
  defaults: { label: "miss", showRequests: true, showCause: true, showRecached: false, hideZero: true },
  render(ctx, o, api) {
    const pc = stdin(ctx).prompt_cache;
    // No cache tokens seen at all: caching is off or the provider doesn't report it — nothing to count.
    if (!pc?.caching_observed) return null;
    const misses = pc.misses ?? 0;
    if (misses === 0 && o.hideZero) return null;
    const label = withLabel(o.label, "miss");
    const segs = label ? [api.seg(`${label} `, { fg: "muted" })] : [];
    segs.push(api.seg(String(misses), { fg: misses > 0 ? "warn" : "fg" }));
    if (o.showRequests && typeof pc.requests === "number") segs.push(api.seg(`/${pc.requests}`, { fg: "muted" }));
    if (o.showRecached && pc.miss_recache_tokens) segs.push(api.seg(` +${api.tokens(pc.miss_recache_tokens)}`, { fg: "muted" }));
    const causes = pc.last_miss_cause?.causes ?? [];
    if (o.showCause && causes.length) {
      const words = causes.map((c) => MISS_CAUSES[c] ?? sanitizeDisplayText(c.replace(/_/g, " "))).join(", ");
      segs.push(api.seg(` (${words})`, { fg: "muted" }));
    }
    return segs;
  },
});
