import { defineWidget } from "../core/types.js";
import { netTokens } from "../core/reset.js";
import type { SessionTokenUsage } from "../data/types.js";
import { labelSchema, stdin, withLabel } from "./_shared.js";

/** Field-wise sum of two usages; either may be missing. */
function addTokens(a: SessionTokenUsage | undefined, b: SessionTokenUsage | undefined): SessionTokenUsage | undefined {
  if (!a || !b) return a ?? b;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    apiCalls: (a.apiCalls ?? 0) + (b.apiCalls ?? 0),
  };
}

export const tokensSession = defineWidget<{
  label: string | null;
  subagents: boolean;
  breakdown: boolean;
  style: "words" | "arrows";
  cacheGlyph: string;
  parens: boolean;
}>({
  id: "tokens.session",
  name: "Session tokens",
  description: "Cumulative tokens this session, subagents included, with optional in/out/cache breakdown.",
  category: "usage",
  sample: "Tokens 3M (↓80k ↑50k ↻417k)",
  schema: {
    type: "object",
    properties: {
      label: { ...labelSchema, default: "Tokens" },
      subagents: {
        type: "boolean",
        default: true,
        title: "Include subagents",
        description: "Add the tokens of Task / Agent subagents (read from their own transcripts) to the total",
      },
      breakdown: { type: "boolean", default: true, title: "Show in/out/cache breakdown" },
      style: { type: "string", enum: ["words", "arrows"], default: "words", title: "Breakdown style", description: "words: in/out/cache · arrows: ↓ ↑ + cache glyph", "x-requires": { breakdown: true } },
      cacheGlyph: { type: "string", enum: ["↻", "↺", "⇄", "≈", "~"], default: "↻", title: "Cache glyph (arrows style)", "x-requires": { breakdown: true, style: "arrows" } },
      parens: { type: "boolean", default: true, title: "Wrap breakdown in ( )", "x-requires": { breakdown: true } },
    },
  },
  defaults: { label: "Tokens", subagents: true, breakdown: true, style: "words", cacheGlyph: "↻", parens: true },
  render(ctx, o, api) {
    // Each part is netted against its own baseline field, then summed (see ResetBaseline.subagentTokens).
    const main = netTokens(ctx.transcript.sessionTokens, ctx.reset);
    const t = o.subagents ? addTokens(main, netTokens(ctx.subagentTokens, ctx.reset, "subagentTokens")) : main;
    if (!t) return null;
    const cache = t.cacheCreationTokens + t.cacheReadTokens;
    const total = t.inputTokens + t.outputTokens + cache;
    if (total <= 0) return null;
    const label = withLabel(o.label, "Tokens");
    const segs = label ? [api.seg(`${label} `, { fg: "muted" })] : [];
    segs.push(api.seg(api.tokens(total), { fg: "fg" }));
    if (o.breakdown) {
      const parts =
        o.style === "arrows"
          ? [`↓${api.tokens(t.inputTokens)}`, `↑${api.tokens(t.outputTokens)}`, ...(cache ? [`${o.cacheGlyph}${api.tokens(cache)}`] : [])]
          : [`in: ${api.tokens(t.inputTokens)}`, `out: ${api.tokens(t.outputTokens)}`, ...(cache ? [`cache: ${api.tokens(cache)}`] : [])];
      const joined = parts.join(o.style === "arrows" ? " " : ", ");
      segs.push(api.seg(o.parens ? ` (${joined})` : ` ${joined}`, { fg: "muted" }));
    }
    return segs;
  },
});

export const tokensCurrent = defineWidget<{ label: string | null; showWindow: boolean; showPercent: boolean }>({
  id: "tokens.current",
  name: "Current context tokens",
  description: "Tokens in the current context window (from the latest API response).",
  category: "context",
  sample: "ctx 84k",
  schema: {
    type: "object",
    properties: {
      label: { ...labelSchema, default: "ctx" },
      showWindow: { type: "boolean", default: false, title: "Append window size (84k/1M)" },
      showPercent: { type: "boolean", default: false, title: "Append percentage (41%)" },
    },
  },
  defaults: { label: "ctx", showWindow: false, showPercent: false },
  render(ctx, o, api) {
    const cw = stdin(ctx).context_window;
    const u = cw?.current_usage;
    if (!u) return null;
    const n = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    if (n <= 0) return null;
    const label = withLabel(o.label, "ctx");
    let text = api.tokens(n);
    if (o.showWindow && cw?.context_window_size) text += `/${api.tokens(cw.context_window_size)}`;
    if (o.showPercent && cw?.context_window_size) text += ` (${Math.round((n / cw.context_window_size) * 100)}%)`;
    return [...(label ? [api.seg(`${label} `, { fg: "muted" })] : []), api.seg(text)];
  },
});

export const tokensSpeed = defineWidget<{ label: string | null }>({
  id: "tokens.outputSpeed",
  name: "Output speed",
  description:
    "Output speed of the latest response, main chain or subagent, in tokens per second (end to end, so time to first token is included; replies under 200 tokens are skipped).",
  category: "usage",
  sample: "42 tok/s",
  schema: { type: "object", properties: { label: { ...labelSchema, default: null } } },
  defaults: { label: null },
  render(ctx, o, api) {
    const speed = ctx.responseSpeed?.tokensPerSecond;
    if (typeof speed !== "number" || !Number.isFinite(speed)) return null;
    const label = withLabel(o.label, "");
    // In the usage colour rather than by level: what counts as fast depends on the model (a Haiku reply
    // runs several times an Opus one), so no one threshold would mean "slow" for all of them.
    return [...(label ? [api.seg(`${label} `, { fg: "muted" })] : []), api.seg(`${speed.toFixed(speed < 10 ? 1 : 0)} tok/s`, { fg: "usage" })];
  },
});
