/**
 * The demo's server, in the browser. The configurator is the real app (web/), built unchanged except
 * for this module, which site/demo/entry.ts loads before it: it answers the app's `/api/*`
 * fetches the way src/server/serve.ts does, with the real render engine and widgets, against one
 * sample session precomputed at build time (site/build.ts). Edits are kept in localStorage.
 *
 * Only what a page without Claude Code behind it can honestly do is real: config, render, widgets,
 * themes. Install / uninstall / reset answer "nothing to do"; the app hides those actions anyway
 * once health says `demo` (web/src/components/Header.tsx).
 */
import "./process-shim";
import { DEFAULT_CONFIG, normalizeConfig } from "../../src/core/config";
import { render } from "../../src/core/layout";
import { widgetManifest } from "../../src/core/registry";
import { listThemes } from "../../src/core/theme";
import type { Ctx, FooterConfig } from "../../src/core/types";
import { registerBuiltinWidgets } from "../../src/widgets/index";
// Written by site/build.ts, served by web/vite.demo.config.ts (typed in context.d.ts).
import demo from "virtual:demo-context";

registerBuiltinWidgets();

type BaseCtx = Omit<Ctx, "theme" | "colorMode">;

/** JSON can't carry Dates: site/build.ts wrote them as { $date: iso }. */
function revive(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(revive);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.$date === "string" && Object.keys(o).length === 1) return new Date(o.$date);
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, revive(x)]));
  }
  return v;
}
const BASE = revive(demo.ctx) as BaseCtx;
const SAMPLE = demo.sample;

const STORE_KEY = "ssp.demo.config";
const USER_PATH = "~/.config/claude-super-statusline/config.json";

// localStorage can throw (blocked storage, private mode): the demo then simply forgets on reload.
function loadLayer(): Partial<FooterConfig> | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Partial<FooterConfig>) : null;
  } catch {
    return null;
  }
}
let memoryLayer: Partial<FooterConfig> | null = loadLayer();
function saveLayer(v: Partial<FooterConfig>): void {
  memoryLayer = v;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(v));
  } catch {
    /* kept in memory for this visit */
  }
}

// The first-run card talks about applying to Claude Code, which the demo can't; skip it.
try {
  localStorage.setItem("ssp.welcomed", "1");
} catch {
  /* the card then shows; harmless */
}

function effective() {
  const user = memoryLayer;
  return {
    config: normalizeConfig(user ?? {}),
    layers: [
      { name: "defaults", path: null, exists: true, value: DEFAULT_CONFIG },
      { name: "user", path: USER_PATH, exists: user !== null, value: user },
      { name: "project", path: `${SAMPLE.cwd}/.claude/claude-super-statusline.json`, exists: false, value: null },
    ],
    paths: { user: USER_PATH, project: `${SAMPLE.cwd}/.claude/claude-super-statusline.json`, samples: "(demo)", dataDir: "(demo)" },
  };
}

/** Same clamp as serve.ts parseColumns: 0 is the unbounded probe, otherwise 20..500. */
function columnsOf(v: unknown): number {
  if (v === undefined || v === null) return 120;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(500, Math.max(20, Math.floor(n)));
}

/** renderPreviews in serve.ts: truecolor for "auto" (xterm.js speaks it), git only when enabled. */
function renderOne(raw: Partial<FooterConfig>, columns: number, fillEmpty: boolean) {
  const config = normalizeConfig(raw ?? {});
  if (config.colorLevel === "auto") config.colorLevel = "truecolor";
  const ctx: BaseCtx = { ...BASE, columns, gitStatus: config.git.enabled ? BASE.gitStatus : null };
  return render(config, ctx, { fillEmpty });
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function handle(url: URL, init: RequestInit | undefined): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const body = () => (typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {});
  switch (`${method} ${url.pathname}`) {
    case "GET /api/health":
      return json({ ok: true, root: "demo", demo: true });
    case "GET /api/config":
      return json(effective());
    case "PUT /api/config": {
      const layer = (body().config ?? {}) as Partial<FooterConfig>;
      saveLayer(layer);
      return json({ ok: true, path: USER_PATH, config: normalizeConfig(layer) });
    }
    case "GET /api/widgets":
      return json(widgetManifest());
    case "GET /api/themes":
      return json(listThemes());
    case "GET /api/samples":
      return json([{ id: SAMPLE.id, label: SAMPLE.project, capturedAt: BASE.now, source: "live", sessionId: SAMPLE.sessionId, cwd: SAMPLE.cwd, project: SAMPLE.project, model: SAMPLE.model }]);
    case "POST /api/render": {
      const b = body();
      return json(renderOne((b.config as Partial<FooterConfig>) ?? effective().config, columnsOf(b.columns), b.fillEmpty === true));
    }
    case "POST /api/render/batch": {
      const b = body();
      const configs = Array.isArray(b.configs) ? (b.configs as Partial<FooterConfig>[]) : [];
      return json({ results: configs.map((c) => renderOne(c, columnsOf(b.columns), b.fillEmpty === true)) });
    }
    // Nothing to install into: report the statusline as already ours, so the app never tries.
    case "GET /api/install":
      return json({ settingsFile: "~/.claude/settings.json", planned: {}, current: null, currentIsOurs: true, savedPrevious: null });
    case "POST /api/install":
      return json({ settingsFile: "~/.claude/settings.json", backup: null });
    case "POST /api/uninstall":
      return json({ settingsFile: "~/.claude/settings.json", restored: null, removed: false });
    case "POST /api/reset":
      return json({ sessionId: SAMPLE.sessionId, baseline: { at: BASE.now } });
    case "GET /api/doctor":
      return json({ layers: effective().layers.map((l) => ({ name: l.name, path: l.path, exists: l.exists, error: null })), plugins: { dirs: [], loaded: [], errors: [] }, settings: { path: "~/.claude/settings.json", statusLine: null, error: null }, lastPayload: null });
    default:
      return json({ error: "not in the demo" }, 404);
  }
}

// Route the app's same-origin /api/* calls here; everything else (assets) goes to the network.
const realFetch = window.fetch.bind(window);
// The cast: Bun's types add fetch.preconnect, which the browser's fetch doesn't need.
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(href, window.location.href);
  if (url.origin === window.location.origin && url.pathname.startsWith("/api/")) return handle(url, init);
  return realFetch(input, init);
}) as typeof fetch;
