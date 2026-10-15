/**
 * Local web configurator. Serves web/dist and a small JSON API on 127.0.0.1 only.
 * The preview endpoint runs the exact same render engine as the statusline.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { listLiveSamples, samplesDir, type Sample } from "../core/capture.js";
import { prepareFixture } from "../core/fixtures.js";
import { loadEffectiveConfig, migrateGitBranchParts, normalizeConfig, projectConfigPath, userConfigPath, writeProjectConfig, writeUserConfig } from "../core/config.js";
import { buildContext } from "../core/context.js";
import { render } from "../core/layout.js";
import { loadPlugins } from "../core/plugins.js";
import { widgetManifest } from "../core/registry.js";
import { listThemes } from "../core/theme.js";
import type { FooterConfig, RenderResult } from "../core/types.js";
import { getHudPluginDir } from "../data/claude-config-dir.js";
import type { StdinData } from "../data/types.js";
import { registerBuiltinWidgets } from "../widgets/index.js";
import { guardRequest, HttpError, MAX_BODY_BYTES, readJson } from "./guard.js";
import { adoptLegacyStatusLine, install, NeedsConfirmError, planInstall, RefreshIntervalError, setRefreshInterval, settingsPath, uninstall } from "./install.js";
import { currentSandbox, enterServeSandbox, isInsideSandbox } from "./sandbox.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = fs.realpathSync(path.resolve(here, "..", ".."));
const WEB_DIST = path.join(ROOT, "web", "dist");
const STARTED_AT = Date.now();
const SRC_DIR = path.join(ROOT, "src");
const FIXTURES_DIR = path.join(SRC_DIR, "fixtures");

/** True once any server source file is newer than this process, e.g. after a git pull. */
function changedSince(dir: string, since: number): boolean {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() ? changedSince(p, since) : fs.statSync(p).mtimeMs > since) return true;
  }
  return false;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function fixtureSamples(): Sample[] {
  try {
    return fs
      .readdirSync(FIXTURES_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({
        id: `fixture:${f.replace(/\.json$/, "")}`,
        label: `fixture · ${f.replace(/\.json$/, "")}`,
        capturedAt: null,
        payload: JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, f), "utf8")),
        source: "fixture" as const,
        file: path.join(FIXTURES_DIR, f),
      }));
  } catch {
    return [];
  }
}

function allSamples(): Sample[] {
  return [...listLiveSamples(), ...fixtureSamples()];
}

/** The project directory a captured stdin payload belongs to, if it says. */
export function sampleCwd(payload: unknown): string | null {
  const p = payload as { workspace?: { current_dir?: unknown }; cwd?: unknown } | null | undefined;
  const dir = p?.workspace?.current_dir ?? p?.cwd;
  return typeof dir === "string" && dir !== "" ? dir : null;
}

/** Canonical form for comparing directories: symlinks resolved when the path exists. */
function canonicalDir(dir: string): string {
  try {
    return fs.realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
}

/**
 * `?cwd=` picks which project's config layer the API reads and writes. Left open, any caller could
 * make us read — or, through a project-scope save, write — `.claude/claude-super-statusline.json` in an
 * arbitrary directory. So it may only name the directory the server runs in or the project of a
 * session Claude Code has actually rendered a statusline for (a captured sample).
 */
function resolveCwd(url: URL): string {
  const asked = url.searchParams.get("cwd");
  if (asked === null || asked === "") return process.cwd();
  const wanted = canonicalDir(asked);
  const known = new Set([canonicalDir(process.cwd())]);
  for (const s of listLiveSamples()) {
    const dir = sampleCwd(s.payload);
    if (dir) known.add(canonicalDir(dir));
  }
  if (!known.has(wanted)) throw new HttpError(400, "cwd must be the server's directory or the project of a captured session");
  return wanted;
}

/**
 * Preview width in terminal cells. 0 is the unbounded single-line probe the options drawer uses;
 * anything else is clamped to a plausible terminal so a request can't ask for a 10-million-column
 * render (which once produced a 20 MB response). Missing → 120, like a typical wide terminal.
 */
export function parseColumns(value: unknown): number {
  if (value === undefined || value === null) return 120;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, "columns must be 0 or a positive number");
  if (n === 0) return 0;
  return Math.min(500, Math.max(20, Math.floor(n)));
}

/** Most configs one /api/render/batch call may carry; the biggest options drawer needs ~40. */
const MAX_BATCH = 100;

/**
 * Render preview(s) of `configs` against one sample, in order. The data context (transcript, git,
 * usage…) only depends on `config.git` — the width is always given explicitly here — so configs that
 * differ in widgets, options or styling share one context: a 40-probe batch costs one transcript read
 * and one git call instead of forty.
 */
async function renderPreviews(configs: Array<Partial<FooterConfig>>, sampleId: string | null, columns: number, fillEmpty: boolean): Promise<RenderResult[]> {
  const now = Date.now();
  const picked = allSamples().find((x) => x.id === sampleId) ?? fixtureSamples()[0];
  // Built-in samples get live-looking times and their bundled transcript (src/core/fixtures.ts).
  // Live samples are shown exactly as Claude Code sent them: filling their gaps with made-up
  // values would e.g. show a cold prompt cache as warm.
  const stdin = (picked?.source === "fixture" && picked.file ? prepareFixture(picked.payload, picked.file, now) : (picked?.payload ?? {})) as StdinData;
  const contexts = new Map<string, ReturnType<typeof buildContext>>();
  return Promise.all(
    configs.map(async (raw) => {
      const config = normalizeConfig(raw ?? {});
      // The preview is painted by xterm.js, which speaks truecolor; "auto" would otherwise follow this server's env.
      if (config.colorLevel === "auto") config.colorLevel = "truecolor";
      const key = JSON.stringify(config.git);
      let ctx = contexts.get(key);
      if (!ctx) {
        ctx = buildContext(stdin, config, { columns, now, deadlineMs: 800 });
        contexts.set(key, ctx);
      }
      return render(config, await ctx, { fillEmpty });
    }),
  );
}

/** What the panel's sample picker needs to group and label a sample, without the payload itself. */
export interface SampleMeta {
  id: string;
  label: string;
  capturedAt: number | null;
  source: "live" | "fixture";
  /** Claude Code session the capture came from; null for bundled fixtures. */
  sessionId: string | null;
  /** Project directory of that session; null for fixtures (their paths are made up). */
  cwd: string | null;
  /** basename(cwd), for grouping by project. */
  project: string | null;
  /** Model display name as Claude Code reported it. */
  model: string | null;
}

/**
 * Samples for the picker: live captures first, newest first, one per session (a session that was
 * captured under two file names — e.g. before and after a rename — shows once), then fixtures.
 */
export function listSampleMeta(samples: Sample[] = allSamples()): SampleMeta[] {
  const seen = new Set<string>();
  const out: SampleMeta[] = [];
  const ordered = [...samples.filter((s) => s.source === "live").sort((a, b) => (b.capturedAt ?? 0) - (a.capturedAt ?? 0)), ...samples.filter((s) => s.source === "fixture")];
  for (const s of ordered) {
    const p = s.payload as { session_id?: unknown; model?: { display_name?: unknown } } | null;
    const live = s.source === "live";
    const sessionId = live ? (typeof p?.session_id === "string" && p.session_id ? p.session_id : s.id) : null;
    if (sessionId) {
      if (seen.has(sessionId)) continue;
      seen.add(sessionId);
    }
    const cwd = live ? sampleCwd(s.payload) : null;
    out.push({
      id: s.id,
      label: s.label,
      capturedAt: s.capturedAt,
      source: s.source,
      sessionId,
      cwd,
      project: cwd ? path.basename(cwd) : null,
      model: typeof p?.model?.display_name === "string" ? p.model.display_name : null,
    });
  }
  return out;
}

async function handleApi(req: Request, url: URL): Promise<Response> {
  const cwd = resolveCwd(url);
  switch (`${req.method} ${url.pathname}`) {
    case "GET /api/config": {
      const eff = loadEffectiveConfig(cwd);
      // samples / dataDir follow $CLAUDE_CONFIG_DIR, so the panel shows where things really are
      // instead of assuming ~/.claude.
      return json({ ...eff, paths: { user: userConfigPath(), project: projectConfigPath(cwd), samples: samplesDir(), dataDir: getHudPluginDir(os.homedir()) } });
    }
    case "PUT /api/config": {
      const body = await readJson<{ scope?: "user" | "project"; config: Partial<FooterConfig> }>(req);
      const normalized = normalizeConfig(body.config ?? {});
      // Migrated before the current version is stamped on: a version-2 file must never hold
      // version-1 lines (a panel loaded before the upgrade could still send them), or the
      // migration would skip it and ahead/behind would silently disappear.
      const { $schema: _s, ...toWrite } = { ...migrateGitBranchParts(body.config ?? {}), version: normalized.version } as Partial<FooterConfig>;
      if (body.scope === "project" && !isInsideSandbox(cwd)) {
        throw new HttpError(403, "sandbox: project-scope saves outside the sandbox are disabled (this would write into a real project)");
      }
      const written = body.scope === "project" ? writeProjectConfig(cwd, toWrite) : writeUserConfig(toWrite);
      return json({ ok: true, path: written, config: normalized });
    }
    case "GET /api/health":
      // super-statusline.sh uses this to tell a server from another checkout (or one started before a pull) from this one.
      return json({
        ok: true,
        root: ROOT,
        pid: process.pid,
        startedAt: STARTED_AT,
        codeChanged: fs.existsSync(SRC_DIR) ? changedSince(SRC_DIR, STARTED_AT) : true,
        webBuilt: fs.existsSync(path.join(WEB_DIST, "index.html")),
        // A sandbox server edits throwaway copies; super-statusline.sh must not mistake it for the real configurator.
        sandbox: currentSandbox() !== null,
      });
    case "GET /api/widgets":
      return json(widgetManifest());
    case "GET /api/doctor": {
      // Everything the old `doctor` CLI printed, so the panel can show provenance and raw inputs.
      const eff = loadEffectiveConfig(cwd);
      const plugins = await loadPlugins(eff.config, cwd);
      let statusLine: unknown = null;
      let settingsError: string | null = null;
      try {
        statusLine = (JSON.parse(fs.readFileSync(settingsPath(), "utf8")) as { statusLine?: unknown }).statusLine ?? null;
      } catch (err) {
        settingsError = (err as Error).message;
      }
      const live = listLiveSamples()[0];
      return json({
        layers: eff.layers.map((l) => ({ name: l.name, path: l.path, exists: l.exists, error: l.error ?? null })),
        plugins: { dirs: plugins.dirs, loaded: plugins.loaded, errors: plugins.errors, skipped: plugins.skipped },
        settings: { path: settingsPath(), statusLine, error: settingsError },
        lastPayload: live ? { id: live.id, capturedAt: live.capturedAt, payload: live.payload } : null,
      });
    }
    case "GET /api/themes":
      return json(listThemes());
    case "GET /api/samples":
      return json(listSampleMeta());
    case "GET /api/sample": {
      const id = url.searchParams.get("id");
      const s = allSamples().find((x) => x.id === id);
      return s ? json(s) : json({ error: "not found" }, 404);
    }
    case "POST /api/render": {
      // No client-supplied stdin payload: it could name any transcript_path / cwd on disk and turn the
      // preview into a file and git-status oracle. Previews render captured samples or fixtures only.
      const body = await readJson<{ config?: Partial<FooterConfig>; sampleId?: string; columns?: number; fillEmpty?: boolean }>(req);
      const [out] = await renderPreviews([body.config ?? loadEffectiveConfig(cwd).config], body.sampleId ?? null, parseColumns(body.columns), body.fillEmpty === true);
      return json(out);
    }
    case "POST /api/render/batch": {
      // The options drawer previews every value of every option; one request instead of dozens.
      const body = await readJson<{ sampleId?: string | null; columns?: number; fillEmpty?: boolean; configs?: unknown }>(req);
      if (!Array.isArray(body.configs) || body.configs.length < 1 || body.configs.length > MAX_BATCH) {
        throw new HttpError(400, `configs must be an array of 1..${MAX_BATCH} configs`);
      }
      const results = await renderPreviews(body.configs as Partial<FooterConfig>[], body.sampleId ?? null, parseColumns(body.columns), body.fillEmpty === true);
      return json({ results });
    }
    case "POST /api/reset": {
      const { resetLatestSession, undoReset } = await import("./reset.js");
      const body = await readJson<{ sessionId?: string; undo?: boolean }>(req);
      if (body.undo && body.sessionId) {
        undoReset(body.sessionId);
        return json({ ok: true, undone: body.sessionId });
      }
      const r = await resetLatestSession(body.sessionId);
      return r ? json(r) : json({ error: "no captured session yet" }, 404);
    }
    case "GET /api/install":
      return json(planInstall());
    case "POST /api/install": {
      // The panel auto-applies on the first save; that must never silently replace someone's
      // claude-hud or custom script. 409 tells the UI to show what would be replaced and ask.
      const body = await readJson<{ confirmReplace?: boolean }>(req);
      try {
        const r = install({ confirmReplace: body.confirmReplace === true });
        return json(r);
      } catch (err) {
        if (err instanceof NeedsConfirmError) return json({ error: "needs-confirm", current: err.current }, 409);
        throw err;
      }
    }
    case "POST /api/refresh-interval": {
      // `seconds: null` clears the timer (refresh only on session events). 400 for anything Claude
      // Code would not accept or when our statusLine isn't the one installed.
      const body = await readJson<{ seconds?: unknown }>(req);
      const seconds = body.seconds === null ? null : typeof body.seconds === "number" ? body.seconds : NaN;
      try {
        return json(setRefreshInterval(seconds));
      } catch (err) {
        if (err instanceof RefreshIntervalError) return json({ error: err.message }, 400);
        throw err;
      }
    }
    case "POST /api/uninstall": {
      await readJson(req); // enforce the JSON body contract even though there are no parameters
      return json(uninstall());
    }
    default:
      return json({ error: "not found" }, 404);
  }
}

function serveStatic(pathname: string): Response {
  let rel = pathname === "/" ? "/index.html" : pathname;
  let file = path.join(WEB_DIST, rel);
  if (!file.startsWith(WEB_DIST)) return new Response("forbidden", { status: 403 });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    rel = "/index.html";
    file = path.join(WEB_DIST, rel);
  }
  if (!fs.existsSync(file)) {
    return new Response("web UI not built yet — run `bun run build:web` (or `bun run dev:web` for hot reload against this API)", { status: 503 });
  }
  const ext = path.extname(file);
  return new Response(Bun.file(file), { headers: { "content-type": MIME[ext] ?? "application/octet-stream" } });
}

/**
 * The whole HTTP surface as a plain function of (request, port), so tests can drive it without
 * binding a socket. `port` is the port we are actually served on — the guard needs it to know which
 * Host / Origin values are ours.
 */
export async function handleRequest(req: Request, port: number): Promise<Response> {
  const denied = guardRequest(req, port);
  if (denied) return denied;
  // Idempotent; lets handleRequest work on its own (tests) and not only after serve() ran.
  registerBuiltinWidgets();
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) {
    try {
      return await handleApi(req, url);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      return json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }
  if (req.method !== "GET" && req.method !== "HEAD") return json({ error: "method not allowed" }, 405);
  return serveStatic(url.pathname);
}

/**
 * Open `url` in the default browser. Never throws: a missing opener (no xdg-open on a headless box)
 * used to escape as an exception and take the freshly started server down with it.
 * Windows has no `start` executable — it's a cmd builtin, and its first quoted argument is the
 * window title, hence the empty "".
 */
function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
  const fallback = () => console.log(`open ${url} in your browser`);
  try {
    const child = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
    void child.exited.then((code) => code !== 0 && fallback());
  } catch {
    fallback();
  }
}

export async function serve(opts: { port: number; open?: boolean; sandbox?: boolean }): Promise<void> {
  if (opts.sandbox) {
    const { root, seeded } = enterServeSandbox();
    console.log(`sandbox → ${root}`);
    console.log(`  seeded from your real setup: ${seeded.length ? seeded.join(", ") : "nothing (fresh install)"}; nothing outside this dir is written`);
  }
  // The plugin's config command is the first thing an upgraded user runs, and it starts this server:
  // the moment to point a statusLine that still runs the pre-0.4.0 `ssp` plugin at this one.
  try {
    const moved = adoptLegacyStatusLine();
    if (moved && !moved.unchanged) console.log(`statusLine switched from the old ssp plugin to this one (${moved.settingsFile})`);
  } catch (err) {
    // An unreadable settings.json: the panel's install state reports it; the server still starts.
    console.error(`could not update the statusLine of the old ssp plugin: ${err instanceof Error ? err.message : String(err)}`);
  }
  registerBuiltinWidgets();
  const { config } = loadEffectiveConfig(process.cwd());
  const plugins = await loadPlugins(config, process.cwd());
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: opts.port,
    // Bun enforces this before our handler runs; readJson re-checks for bodies without Content-Length.
    maxRequestBodySize: MAX_BODY_BYTES,
    fetch: (req, srv) => handleRequest(req, srv.port ?? opts.port),
  });
  const address = `http://127.0.0.1:${server.port}`;
  console.log(`claude-super-statusline configurator → ${address}`);
  if (plugins.errors.length) for (const e of plugins.errors) console.error(`plugin error ${e.file}: ${e.message}`);
  for (const s of plugins.skipped) console.error(`plugin dir skipped ${s.dir}: ${s.reason}`);
  if (opts.open) openBrowser(address);
}
