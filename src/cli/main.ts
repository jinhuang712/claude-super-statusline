#!/usr/bin/env bun
/**
 * claude-code-super-statusline CLI. The `render` path must stay lean: no server or UI imports here.
 */
import { captureSample } from "../core/capture.js";
import { prepareFixture } from "../core/fixtures.js";
import { loadEffectiveConfig } from "../core/config.js";
import { buildContext } from "../core/context.js";
import { guardLeadingSpace, render } from "../core/layout.js";
import { loadPlugins } from "../core/plugins.js";
import { readStdin } from "../data/stdin.js";
import { registerBuiltinWidgets } from "../widgets/index.js";

function arg(name: string, argv: string[]): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0) return argv[i + 1] ?? "";
  const kv = argv.find((a) => a.startsWith(`--${name}=`));
  return kv ? kv.slice(name.length + 3) : undefined;
}

async function cmdRender(argv: string[]): Promise<void> {
  const started = performance.now();
  registerBuiltinWidgets();
  const fixture = arg("fixture", argv);
  // A fixture gets live-looking times and its bundled sample transcript (src/core/fixtures.ts).
  let stdin = fixture ? prepareFixture(JSON.parse(await Bun.file(fixture).text()) as Awaited<ReturnType<typeof readStdin>>, fixture) : await readStdin();
  if (!stdin) {
    console.log("claude-code-super-statusline: waiting for Claude Code statusline JSON on stdin (or pass --fixture <file>)");
    return;
  }
  const cwd = stdin!.workspace?.current_dir ?? stdin!.cwd;
  const { config } = loadEffectiveConfig(cwd);
  // Fixture renders (README preview, tests, `super-statusline.sh render-test`) are not a real session: capturing
  // them would put a fake "live" session at the top of the list, which `reset` and the web
  // preview then pick as "the latest session".
  if (config.captureSamples && !fixture) captureSample(stdin);
  await loadPlugins(config, cwd);
  const columnsArg = arg("columns", argv);
  const ctx = await buildContext(stdin!, config, { columns: columnsArg ? Number(columnsArg) : undefined });
  const result = render(config, ctx);
  // One write, awaited until flushed: main() exits right after this returns, and a pipe write
  // still sitting in a buffer would be cut off. Only this Claude Code-bound output is guarded: the
  // web preview renders the same lines without Claude Code's per-line trim.
  await writeFully(process.stdout, result.lines.map((line) => `${guardLeadingSpace(line)}\n`).join(""));
  // CLAUDE_CODE_SUPER_STATUSLINE_DEBUG is the name before the rename; still honoured.
  if (process.env.CLAUDE_SUPER_STATUSLINE_DEBUG || process.env.CLAUDE_CODE_SUPER_STATUSLINE_DEBUG) {
    const debug = [`[claude-code-super-statusline] render ${result.ms.toFixed(1)}ms total ${(performance.now() - started).toFixed(1)}ms`, ...result.errors.map((e) => `[claude-code-super-statusline] ${e.widget}: ${e.message}`)];
    await writeFully(process.stderr, debug.map((l) => `${l}\n`).join(""));
  }
}

/** Resolve once `text` has been handed to the OS, so exiting afterwards can't truncate it. */
function writeFully(stream: NodeJS.WriteStream, text: string): Promise<void> {
  if (!text) return Promise.resolve();
  return new Promise((resolve) => stream.write(text, () => resolve()));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0] ?? "render";
  switch (cmd) {
    case "render":
      await cmdRender(argv);
      // Exit now rather than when the event loop drains. Work that lost a deadline race (a git call
      // past the VCS deadline, a slow transcript read, their timeout timers) would otherwise keep
      // this process alive for seconds after the line is printed, and Claude Code treats the
      // statusline as busy until it exits. Nothing is lost: a late git status is finished by the
      // detached helper (see core/vcs-cache.ts), and the transcript is re-read incrementally.
      process.exit(0);
    case "serve": {
      const { serve } = await import("../server/serve.js");
      const sandbox = argv.includes("--sandbox");
      // A sandbox gets its own default port so it never answers where /super-statusline:config expects the real one.
      return serve({ port: Number(arg("port", argv) ?? (sandbox ? 4878 : 4877)), open: argv.includes("--open"), sandbox });
    }
    case "install": {
      const { install, planInstall, NeedsConfirmError } = await import("../server/install.js");
      if (argv.includes("--dry-run")) {
        console.log(JSON.stringify(planInstall(), null, 2));
        return;
      }
      try {
        const r = install({ confirmReplace: argv.includes("--replace") });
        if (r.unchanged) console.log(`statusLine already installed in ${r.settingsFile} — nothing to do`);
        else console.log(`installed statusLine → ${r.settingsFile}${r.backup ? ` (backup: ${r.backup})` : ""}`);
      } catch (err) {
        if (!(err instanceof NeedsConfirmError)) throw err;
        const cmdText = (err.current as { command?: unknown } | null)?.command;
        console.log(`settings.json already has another statusLine${typeof cmdText === "string" ? `: ${cmdText}` : ""}`);
        console.log("re-run with --replace to use claude-code-super-statusline instead; `uninstall` puts the old one back");
        process.exitCode = 1;
      }
      return;
    }
    case "uninstall": {
      const { uninstall } = await import("../server/install.js");
      const r = uninstall();
      if (!r.removed) console.log(`the statusLine in ${r.settingsFile} isn't claude-code-super-statusline's — left untouched`);
      else console.log(`statusLine ${r.restored ? "restored to the previous one" : "removed"} in ${r.settingsFile}${r.backup ? ` (backup: ${r.backup})` : ""}`);
      return;
    }
    case "reset": {
      const { resetLatestSession, undoReset } = await import("../server/reset.js");
      // `--session` names the session to reset (the panel passes the one it previews).
      // Without it (run by hand in a terminal) both paths fall back to the most recent session.
      if (argv.includes("--undo")) {
        const { listLiveSamples } = await import("../core/capture.js");
        const id = arg("session", argv) || listLiveSamples()[0]?.id;
        if (id) undoReset(id);
        console.log(id ? `counters restored for session ${id}` : "no session seen yet");
        return;
      }
      const r = await resetLatestSession(arg("session", argv));
      if (!r) {
        console.log("no captured session yet — the statusline has to render once first");
        process.exitCode = 1;
        return;
      }
      const t = r.baseline.tokens;
      console.log(`counters reset for session ${r.sessionId}: cost $${r.baseline.costUsd.toFixed(2)}, tokens ${t.inputTokens + t.outputTokens + t.cacheCreationTokens + t.cacheReadTokens}, api calls ${t.apiCalls ?? 0}, lines +${r.baseline.linesAdded} -${r.baseline.linesRemoved}`);
      return;
    }
    case "doctor": {
      const { doctor } = await import("../server/doctor.js");
      return doctor();
    }
    case "--help":
    case "-h":
    case "help":
      console.log(`claude-code-super-statusline <command>

  render            read Claude Code statusline JSON on stdin, print the status line (default)
  serve [--port N] [--open]   start the local web configurator (127.0.0.1:4877)
  serve --sandbox             same, on :4878, against temp copies of your config/samples/statusLine
  reset [--undo]    zero the session counters (cost, tokens, api calls, lines) from now on
  install [--dry-run] [--replace]  merge statusLine into ~/.claude/settings.json (with backup);
                              --replace is needed when another statusline is set (kept for uninstall)
  uninstall                   remove our statusLine entry and restore the one it replaced
  doctor                      show effective config, layers, plugins, last sample, timing
`);
      return;
    default:
      console.error(`unknown command: ${cmd}`);
      process.exit(2);
  }
}

main().catch((err) => {
  // Never blank the statusline silently: print a one-line marker.
  console.log(`[claude-code-super-statusline] error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(0);
});
