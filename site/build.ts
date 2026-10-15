/**
 * Builds the GitHub Pages site into site/dist: one page (site/index.html, site/site.css,
 * site/landing.ts) — the three presets rendered by the real engine, the drag-and-drop recording,
 * and the real configurator (web/) mounted inside it, its API running in the browser
 * (site/demo/api.ts) against one precomputed sample session. web/vite.demo.config.ts builds it.
 *
 *   bun site/build.ts            build
 *   bun site/build.ts --serve    build, then serve site/dist on http://127.0.0.1:4880
 *
 * The sample session is src/fixtures/basic.json made live the way the configurator does it
 * (prepareFixture), in a throwaway git repo so the git widgets show a real branch and changes.
 * Everything runs under a temporary HOME / CLAUDE_CONFIG_DIR: the demo must never pick up the
 * builder's own ~/.claude (MCP servers, hooks, rules would otherwise be counted into it).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const SITE = path.join(ROOT, "site");
const OUT = path.join(SITE, "dist");
const BUILD = path.join(SITE, ".build");
/** Where the sample session claims to live; node-shims.ts reports the same home to the widgets. */
const DEMO_HOME = "/Users/you";
/** The sample session is spent on this very project, so the page shows super-statusline working on itself. */
const DEMO_NAME = "claude-super-statusline";
const DEMO_OWNER = "jinhuang712";
const DEMO_PROJECT = `${DEMO_HOME}/dev/${DEMO_NAME}`;
/**
 * Width the presets are laid out at on the welcome page: a common terminal, and it fits the hero.
 * At 100 the Full preset's second line (the 40-character jinhuang712/claude-super-statusline,
 * branch, file counts, diff, and context on the right) no longer fits, and the engine cuts the diff;
 * 120 leaves every line whole with room to spare. site/landing.ts scales the font to the terminal.
 */
const PRESET_COLUMNS = 120;

// The builder's real home, read before HOME is pointed elsewhere: the leak check below needs it.
const REAL_HOME = os.homedir();
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "super-statusline-site-")));
process.env.HOME = path.join(tmp, "home");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.XDG_CONFIG_HOME = path.join(tmp, "xdg");
fs.mkdirSync(process.env.HOME, { recursive: true });

function run(cmd: string[], cwd: string): void {
  const r = Bun.spawnSync({ cmd, cwd, stdout: "inherit", stderr: "inherit", env: process.env });
  if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed (${r.exitCode})`);
}

/** A tiny repo on feat/login with one modified and one untracked file: `git:(feat/login*) !1 ?1`. */
function demoRepo(): string {
  const dir = path.join(tmp, DEMO_NAME);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "login.ts"), "export function login() {\n  return true;\n}\n");
  fs.writeFileSync(path.join(dir, "README.md"), `# ${DEMO_NAME}\n`);
  const git = (...args: string[]) => run(["git", "-c", "user.name=demo", "-c", "user.email=demo@example.com", "-c", "init.defaultBranch=main", ...args], dir);
  git("init", "-q");
  // Only parsed, never fetched: it gives the branch widget's link its github.com base.
  git("remote", "add", "origin", `https://github.com/${DEMO_OWNER}/${DEMO_NAME}.git`);
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  git("checkout", "-q", "-b", "feat/login");
  fs.appendFileSync(path.join(dir, "src", "login.ts"), "\nexport const remember = true;\n");
  fs.writeFileSync(path.join(dir, "src", "session.ts"), "export {};\n");
  return dir;
}

/**
 * The precomputed data context, written for the demo and the presets (Dates as { $date }, temp
 * paths rewritten to ~/dev/claude-super-statusline). Returns the file it wrote.
 */
async function demoContext(): Promise<string> {
  // Imported after HOME is set: some modules resolve their directories on first use.
  const { prepareFixture } = await import("../src/core/fixtures.ts");
  const { buildContext } = await import("../src/core/context.ts");
  const { normalizeConfig } = await import("../src/core/config.ts");
  const repo = demoRepo();
  const file = path.join(ROOT, "src/fixtures/basic.json");
  const now = Date.now();
  const payload = prepareFixture(JSON.parse(fs.readFileSync(file, "utf8")), file, now);
  // The fixture's own project (~/dev/webapp): its transcript's tool calls name files under it.
  const fixtureProject = payload.workspace?.project_dir ?? payload.cwd;
  payload.session_id = "demo-session";
  payload.cwd = repo;
  // The fixture's own repo (acme/webapp) would win over the demo repo's remote in git.repo.
  payload.workspace = { ...payload.workspace, current_dir: repo, project_dir: repo, repo: { host: "github.com", owner: DEMO_OWNER, name: DEMO_NAME } };
  const ctx = await buildContext(payload, normalizeConfig({ git: { enabled: true, cacheMs: 0 } }), { columns: 120, now, gitDeadlineMs: 10_000 });
  if (!ctx.gitStatus) throw new Error("demo repo: no git status — is git installed?");

  const encoded = JSON.stringify(
    { ctx, sample: { id: "demo", sessionId: "demo-session", cwd: DEMO_PROJECT, project: DEMO_NAME, model: "Sonnet 5" } },
    function (key, value) {
      const raw = (this as Record<string, unknown>)[key];
      return raw instanceof Date ? { $date: raw.toISOString() } : value;
    },
  )
    // The session "happened" in ~/dev/claude-super-statusline, not in this machine's temp dir.
    .split(repo).join(DEMO_PROJECT)
    .split(fixtureProject).join(DEMO_PROJECT)
    .split(tmp).join(DEMO_HOME)
    .split(os.tmpdir()).join("/tmp");
  if (encoded.includes(REAL_HOME)) throw new Error("demo context mentions the builder's home directory");
  fs.mkdirSync(BUILD, { recursive: true });
  const out = path.join(BUILD, "demo-context.json");
  fs.writeFileSync(out, encoded);
  return out;
}

/** The presets' HTML, from site/presets.ts in a process whose home is the demo's (see that file). */
function presetsHtml(contextFile: string): string {
  const r = Bun.spawnSync({ cmd: ["bun", path.join(SITE, "presets.ts"), contextFile, String(PRESET_COLUMNS)], cwd: ROOT, env: { ...process.env, HOME: DEMO_HOME }, stdout: "pipe", stderr: "inherit" });
  if (r.exitCode !== 0) throw new Error(`site/presets.ts failed (${r.exitCode})`);
  return r.stdout.toString();
}

/** The recordings the page plays and their posters (site/landing.ts picks one per scheme); the rest of docs/images is README-only. */
const VIDEOS = ["dnd-dark.mp4", "dnd-light.mp4", "dnd-dark-poster.jpg", "dnd-light-poster.jpg"];

/** Every file of the built site, for the leak check. */
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

async function main(): Promise<void> {
  try {
    const presets = presetsHtml(await demoContext());
    // The page Vite builds (web/vite.demo.config.ts reads it): the template with the presets in.
    fs.writeFileSync(path.join(BUILD, "index.html"), fs.readFileSync(path.join(SITE, "index.html"), "utf8").replace("<!-- PRESETS -->", presets));
    run(["bun", "x", "vite", "build", "--config", "vite.demo.config.ts", "--logLevel", "warn"], path.join(ROOT, "web"));
    fs.mkdirSync(path.join(OUT, "images"), { recursive: true });
    for (const v of VIDEOS) fs.copyFileSync(path.join(ROOT, "docs/images", v), path.join(OUT, "images", v));
    // GitHub Pages runs Jekyll unless told not to; plain files need no processing.
    fs.writeFileSync(path.join(OUT, ".nojekyll"), "");
    // The page and its bundle (which carries the demo session) must not mention the builder's home.
    for (const f of walk(OUT).filter((f) => /\.(html|js|css|json)$/.test(f))) {
      if (fs.readFileSync(f, "utf8").includes(REAL_HOME)) throw new Error(`${path.relative(ROOT, f)} mentions the builder's home directory`);
    }
    console.log(`site → ${path.relative(ROOT, OUT)}/`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (process.argv.includes("--serve")) serve();
}

/** A static server for looking at the build locally (file:// can't load ES modules). */
function serve(): void {
  const port = 4880;
  Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch(req) {
      const url = new URL(req.url);
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith("/")) rel += "index.html";
      const file = path.join(OUT, rel);
      if (!file.startsWith(OUT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return new Response("not found", { status: 404 });
      return new Response(Bun.file(file));
    },
  });
  console.log(`serving http://127.0.0.1:${port}/`);
}

await main();
