/**
 * Built-in sample sessions (src/fixtures/*.json) made to look alive.
 *
 * Fixture payloads store 0 for times, and may point `transcript_path` at a bundled sample transcript
 * with a *relative* path (e.g. "transcripts/basic.jsonl"). Those transcripts use numbers for
 * `timestamp` — seconds relative to now (-30 = half a minute ago) — so "running" agents, the
 * last reply and output speed look current whenever the sample is shown. `prepareFixture` turns
 * both into what a live session would send: absolute times, and a real transcript file with ISO
 * timestamps written to the temp dir (refreshed at most once a minute, so parse caches still help).
 *
 * Without a bundled transcript, the transcript-driven widgets (agents, todos, tools, MCP, output
 * speed, compactions) could never be previewed with the built-in samples.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Re-materialise a sample transcript when the copy is older than this. */
const REFRESH_MS = 60_000;

/** Fill the time fields fixtures leave at 0 so resets/expiries read as "in a while", not "now". */
function hydrateTimes(p: Record<string, any>, now: number): void {
  const sec = Math.floor(now / 1000);
  if (p.rate_limits?.five_hour && !p.rate_limits.five_hour.resets_at) p.rate_limits.five_hour.resets_at = sec + 3 * 3600 + 41 * 60;
  if (p.rate_limits?.seven_day && !p.rate_limits.seven_day.resets_at) p.rate_limits.seven_day.resets_at = sec + 5 * 86400 + 2 * 3600;
  if (p.rate_limits?.spend_limit && !p.rate_limits.spend_limit.resets_at) p.rate_limits.spend_limit.resets_at = sec + 12 * 86400;
  if (p.prompt_cache && !p.prompt_cache.expires_at) p.prompt_cache.expires_at = sec + 42 * 60;
}

/** Copy one relative-time JSONL file to `out` with absolute ISO timestamps. False when `src` can't be read. */
function writeHydrated(src: string, out: string, now: number): boolean {
  let lines: string[];
  try {
    lines = fs.readFileSync(src, "utf8").split("\n").filter(Boolean);
  } catch {
    return false;
  }
  const body = lines
    .map((line) => {
      const e = JSON.parse(line) as { timestamp?: unknown };
      if (typeof e.timestamp === "number") e.timestamp = new Date(now + e.timestamp * 1000).toISOString();
      return JSON.stringify(e);
    })
    .join("\n");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = `${out}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${body}\n`);
  fs.renameSync(tmp, out); // atomic: a concurrent render never reads half a file
  return true;
}

/**
 * Write `src` (relative-time JSONL) as a real transcript next to the OS temp dir; returns its path.
 * A bundled `<name>/subagents/` folder beside it is copied along, laid out the way Claude Code
 * stores subagent transcripts (see src/core/subagents.ts), so their usage shows in the samples too.
 */
function materializeTranscript(src: string, now: number): string | null {
  const dir = path.join(os.tmpdir(), "claude-super-statusline-fixtures");
  const out = path.join(dir, path.basename(src));
  try {
    if (now - fs.statSync(out).mtimeMs < REFRESH_MS) return out;
  } catch {
    /* not written yet */
  }
  const subSrc = path.join(path.dirname(src), path.basename(src, ".jsonl"), "subagents");
  const subOut = path.join(dir, path.basename(src, ".jsonl"), "subagents");
  let subFiles: string[] = [];
  try {
    subFiles = (fs.readdirSync(subSrc, { recursive: true }) as string[]).filter((f) => f.endsWith(".jsonl"));
  } catch {
    /* this sample has no subagents */
  }
  // Subagents first: the main file's mtime is the refresh clock above, so it is written last.
  for (const f of subFiles) writeHydrated(path.join(subSrc, f), path.join(subOut, f), now);
  // The fixture names a transcript that isn't there: behave like a missing transcript.
  return writeHydrated(src, out, now) ? out : null;
}

/**
 * A fixture payload as a live session would send it. `fixtureFile` is where the payload was read
 * from; a relative transcript_path is resolved against its directory.
 */
export function prepareFixture<T>(payload: T, fixtureFile: string, now = Date.now()): T {
  const p = structuredClone(payload) as Record<string, any>;
  hydrateTimes(p, now);
  const tp = p.transcript_path;
  if (typeof tp === "string" && tp && !path.isAbsolute(tp)) {
    p.transcript_path = materializeTranscript(path.resolve(path.dirname(fixtureFile), tp), now) ?? tp;
  }
  return p as T;
}
