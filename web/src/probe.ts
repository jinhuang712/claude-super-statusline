/**
 * "Probes" are one-widget renders against the current session — today the one-line "what it prints
 * now" in an open options panel. They used to preview every value of every option and every widget
 * in the picker; rendered one request each, opening a busy widget cost 20+ requests and every click
 * another 20, which is why they are batched.
 *
 * `probe()` instead queues the render and flushes everything queued in the same tick as one
 * POST /api/render/batch (chunked to the server's 100-config cap). A short-lived cache answers
 * repeats (re-opening a drawer, toggling back) without a round trip; it expires quickly because a
 * live session sample keeps changing underneath the same id.
 */
import { useEffect, useState } from "react";
import { api, type FooterConfig, type RenderResult, type WidgetInstance } from "./api";
import { useStore } from "./store";

/** Must stay ≤ the server's MAX_BATCH. */
const BATCH = 100;
const CACHE_MS = 15_000;
const CACHE_MAX = 400;

interface Pending {
  key: string;
  config: FooterConfig;
  sampleId: string | null;
  resolve: (r: RenderResult | null) => void;
}

let queue: Pending[] = [];
let scheduled = false;
const cache = new Map<string, { at: number; result: RenderResult | null }>();

function remember(key: string, result: RenderResult | null) {
  cache.set(key, { at: Date.now(), result });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!); // Map keeps insertion order: drop the oldest
}

async function flush() {
  scheduled = false;
  const batch = queue;
  queue = [];
  const bySample = new Map<string | null, Pending[]>();
  for (const p of batch) bySample.set(p.sampleId, [...(bySample.get(p.sampleId) ?? []), p]);
  for (const [sampleId, items] of bySample) {
    for (let i = 0; i < items.length; i += BATCH) {
      const chunk = items.slice(i, i + BATCH);
      try {
        const { results } = await api.renderBatch(
          chunk.map((p) => p.config),
          sampleId,
          0, // 0 = unbounded width: a probe shows the widget whole, never wrapped
          true,
        );
        chunk.forEach((p, j) => {
          remember(p.key, results[j] ?? null);
          p.resolve(results[j] ?? null);
        });
      } catch {
        // A failed probe only loses a sample string; the drawer still works.
        chunk.forEach((p) => p.resolve(null));
      }
    }
  }
}

/** Render one config against a sample, batched with every other probe made in the same tick. */
export function probe(config: FooterConfig, sampleId: string | null): Promise<RenderResult | null> {
  const key = JSON.stringify([config, sampleId]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return Promise.resolve(hit.result);
  return new Promise((resolve) => {
    queue.push({ key, config, sampleId, resolve });
    if (!scheduled) {
      scheduled = true;
      setTimeout(() => void flush(), 0);
    }
  });
}

/**
 * The config a probe renders: just this widget, on one line, with the current theme, bar glyphs, colour mode
 * and empty-widget placeholder (without it, an empty widget showed its sample here but "Name –" above).
 * Colours stay on (truecolor) so samples can be drawn exactly as the terminal would.
 */
export function probeConfig(inst: WidgetInstance, theme: FooterConfig["theme"] | undefined, bar: FooterConfig["bar"] | undefined, colorMode: FooterConfig["colorMode"] = "thresholds", emptyText = ""): FooterConfig {
  return {
    // The current version: at 1 the server would migrate this one-widget config and add a Changes
    // widget after every git.branch probe (src/core/config.ts migrateGitBranchParts).
    version: 2,
    theme: theme ?? "default",
    ...(bar ? { bar } : {}),
    colorMode,
    colorLevel: "truecolor",
    separator: " ",
    columnsOffset: 0,
    emptyText,
    lines: [{ left: [inst] }],
    desktop: { lines: [] },
    git: { enabled: true, cacheMs: 2000 },
    plugins: { dirs: [] },
    captureSamples: false,
  };
}

/** Rendered first lines (ANSI kept) for each instance; re-probes when the instances or sample change. */
export function useProbe(insts: WidgetInstance[]): string[] {
  const sampleId = useStore((s) => s.sampleId);
  const theme = useStore((s) => s.config?.theme);
  const bar = useStore((s) => s.config?.bar);
  const colorMode = useStore((s) => s.config?.colorMode);
  const emptyText = useStore((s) => s.config?.emptyText ?? "");
  const [out, setOut] = useState<string[]>([]);
  const key = JSON.stringify([insts, sampleId, theme, bar, colorMode, emptyText]);
  useEffect(() => {
    let alive = true;
    Promise.all(insts.map((inst) => probe(probeConfig(inst, theme, bar, colorMode, emptyText), sampleId).then((r) => r?.lines[0]?.trimEnd() ?? ""))).then((texts) => {
      if (alive) setOut(texts);
    });
    return () => {
      alive = false; // a newer key is in flight; drop this stale answer
    };
    // `key` captures every input; listing the objects themselves would re-run on identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return out;
}
