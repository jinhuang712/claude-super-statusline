/**
 * Merge our statusLine entry into Claude Code's settings.json atomically, keeping a timestamped backup.
 * Structured JSON merge — never string replacement.
 *
 * The user's own statusline (claude-hud, a hand-written script, …) must survive whatever we do:
 *   - isOurStatusLine() is the single place that decides whether an entry is ours.
 *   - Installing over someone else's entry needs explicit consent (`confirmReplace`) and parks that
 *     entry under PREVIOUS_KEY. Installing over an older entry of *ours* (another checkout, an older
 *     plugin version) never touches PREVIOUS_KEY — earlier versions overwrote it with our own stale
 *     command, and the user's original was lost.
 *   - Uninstall only removes an entry that is ours, and puts PREVIOUS_KEY back if it holds a foreign one.
 *
 * Nothing here prints; the CLI and the HTTP API report results in their own way.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getClaudeConfigDir } from "../data/claude-config-dir.js";

/** settings.json key holding the statusLine we replaced, restored by uninstall. */
export const PREVIOUS_KEY = "statusLine.previous.claude-super-statusline";
/**
 * The same key under the product's earlier names, newest first (`claude-code-super-statusline` from
 * 0.4.0 to 0.5.x, `claude-code-ssp` before that). Read wherever PREVIOUS_KEY is (the new one wins when
 * several exist) and moved to it on the next install, so a statusline parked by an older version still
 * comes back on uninstall.
 */
export const LEGACY_PREVIOUS_KEYS = ["statusLine.previous.claude-code-super-statusline", "statusLine.previous.claude-code-ssp"] as const;
/** The `claude-code-ssp` key from before 0.4.0, the last of LEGACY_PREVIOUS_KEYS. */
export const LEGACY_PREVIOUS_KEY = LEGACY_PREVIOUS_KEYS[1];

/**
 * `statusLine.refreshInterval` a fresh install writes, in seconds. Claude Code re-runs the command
 * every N seconds on top of its event-driven updates (minimum 1, per code.claude.com/docs/en/statusline).
 * 5 s makes a configurator save show up quickly while a warm render costs only a few milliseconds.
 */
export const DEFAULT_REFRESH_SECONDS = 5;
/** Claude Code's documented minimum for refreshInterval. */
const MIN_REFRESH_SECONDS = 1;
/**
 * Our own ceiling. A timer slower than an hour refreshes almost nothing; rejecting it also keeps a
 * typo such as 3000 (meant as ms) from quietly turning the timer off in practice.
 */
const MAX_REFRESH_SECONDS = 3600;

/** The parked statusLine, under either key name. */
function parkedPrevious(settings: Record<string, unknown>): unknown {
  return settings[PREVIOUS_KEY] ?? LEGACY_PREVIOUS_KEYS.map((key) => settings[key]).find((value) => value !== undefined);
}

export interface InstallOptions {
  /** Override the launcher command; default resolves this checkout's src/cli/main.ts via bun. */
  command?: string;
  refreshInterval?: number;
  /** Required to replace a statusLine that isn't ours. Without it, install throws NeedsConfirmError. */
  confirmReplace?: boolean;
}

export function settingsPath(homeDir = os.homedir()): string {
  return path.join(getClaudeConfigDir(homeDir), "settings.json");
}

/**
 * Is this settings.json statusLine entry one that we wrote?
 * Every command we install runs `<plugin root>/src/cli/main.ts render`, where the plugin root is either
 * a checkout called claude-super-statusline (or claude-code-super-statusline, its name until the
 * rename) or a Claude Code plugin-cache dir for the `super-statusline` plugin — or, before 0.4.0,
 * claude-code-ssp and `ssp`, which must still count as ours so an upgrade replaces them instead of
 * parking them as "your previous statusline". claude-hud
 * and other tools use different entry points, so all three markers together don't collide with them.
 * The plugin dir is followed by `/` in a version-pinned path (`…/ssp/0.2.0/src/…`) and by `"` in the
 * launcher, which quotes the dir and then globs the version dirs after the closing quote.
 */
export function isOurStatusLine(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const cmd = (entry as { command?: unknown }).command;
  if (typeof cmd !== "string") return false;
  return /src[\\/]cli[\\/]main\.ts/.test(cmd) && /\brender\b/.test(cmd) && /claude-(?:code-)?(?:super-statusline|ssp)|[\\/](?:super-statusline|ssp)[\\/"]/.test(cmd);
}

/** A command that runs the plugin from before 0.4.0, when it was called `ssp` (any marketplace name). */
const LEGACY_PLUGIN_CACHE = /[\\/]plugins[\\/]cache[\\/][^\\/"]+[\\/]ssp[\\/"]/;

/**
 * The bun binary to bake into the command. process.execPath is the *resolved* binary — under Homebrew
 * that's /opt/homebrew/Cellar/bun/<version>/bin/bun, which disappears after `brew upgrade` + cleanup and
 * silently blanks the statusline. The PATH entry (/opt/homebrew/bin/bun, ~/.bun/bin/bun) is a stable
 * symlink, so prefer it; fall back to execPath, then to a bare `bun` looked up at run time.
 */
export function stableBunPath(): string {
  const onPath = Bun.which("bun");
  if (onPath) return onPath;
  return path.basename(process.execPath).startsWith("bun") ? process.execPath : "bun";
}

/**
 * When we run from Claude Code's plugin cache (`…/plugins/cache/<marketplace>/<plugin>/<version>/`),
 * returns the per-plugin dir above the version dir. A plugin update installs a new version dir next to
 * the old one, so a command pinned to today's version would keep running stale code — or nothing,
 * once the old dir is cleaned up.
 */
export function pluginCacheBase(entry: string): string | null {
  const m = entry.match(/^(.*[\\/]plugins[\\/]cache[\\/][^\\/]+[\\/][^\\/]+)[\\/][^\\/]+[\\/]src[\\/]cli[\\/]main\.ts$/);
  return m ? m[1]! : null;
}

/** POSIX double-quoted string: only \ " $ ` are special inside double quotes. */
function dq(s: string): string {
  return `"${s.replace(/[\\"$`]/g, (c) => `\\${c}`)}"`;
}

/** POSIX single-quoted string: nothing is special except the quote itself. */
function sq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Quote a path only when it needs it, so ordinary installs keep the familiar `bun "…" render` shape. */
function maybeQuote(s: string): string {
  return /^[A-Za-z0-9_./~+-]+$/.test(s) ? s : JSON.stringify(s);
}

/**
 * The statusLine command for an entry point. From a plugin cache it is a small sh script that picks the
 * newest installed version at run time (the same approach claude-hud's installer uses); otherwise the
 * entry path is used as is.
 */
export function launcherCommand(entry: string, bun = stableBunPath()): string {
  const base = pluginCacheBase(entry);
  if (!base) return `${maybeQuote(bun)} ${JSON.stringify(entry)} render`;
  const script = [
    // Newest version dir that actually has our entry point; `sort -V` orders 0.10.0 after 0.9.0.
    `d=$(for x in ${dq(base)}/*/; do [ -f "\${x}src/cli/main.ts" ] && echo "$x"; done | sort -V | tail -n 1)`,
    // Print something instead of failing silently if the plugin was removed without uninstalling.
    `[ -n "$d" ] || { echo "claude-code-super-statusline: plugin files not found — run /plugin to reinstall"; exit 0; }`,
    `exec ${dq(bun)} "\${d}src/cli/main.ts" render`,
  ].join("; ");
  return `sh -c ${sq(script)}`;
}

/** This install's src/cli/main.ts. */
function defaultEntry(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "cli", "main.ts");
}

export function defaultCommand(): string {
  return launcherCommand(defaultEntry());
}

function readSettings(file: string): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`cannot parse ${file}: ${(err as Error).message}`);
  }
}

function writeSettings(file: string, value: Record<string, unknown>): string | null {
  let backup: string | null = null;
  if (fs.existsSync(file)) {
    backup = `${file}.bak.${Date.now()}`;
    fs.copyFileSync(file, backup);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(tmp, file);
  return backup;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** What install would do, without doing it. Also what GET /api/install returns. */
export interface InstallPlan {
  settingsFile: string;
  /** The statusLine entry install would write. */
  planned: Record<string, unknown>;
  /** settings.json's statusLine right now (null when there is none). */
  current: unknown;
  currentIsOurs: boolean;
  /** A foreign statusLine parked by an earlier install; uninstall restores it. */
  savedPrevious: unknown;
  /** Alias of `current`, kept for panels built before `current` existed. */
  previous: unknown;
}

export function planInstall(opts: InstallOptions = {}): InstallPlan {
  const file = settingsPath();
  const settings = readSettings(file);
  const current = settings.statusLine ?? null;
  const currentIsOurs = isOurStatusLine(current);
  // Reinstalling over our own entry keeps whatever the user added to it (refreshInterval, padding…);
  // only the command is ours to update.
  // A fresh entry refreshes on a timer: Claude Code otherwise re-runs the statusline only on session
  // events, so a save in the configurator (or the clock) would not show until the next message.
  const planned: Record<string, unknown> = currentIsOurs && isPlainObject(current) ? { ...current } : { padding: 0, refreshInterval: DEFAULT_REFRESH_SECONDS };
  planned.type = "command";
  planned.command = opts.command ?? defaultCommand();
  if (opts.refreshInterval) planned.refreshInterval = opts.refreshInterval;
  const saved = parkedPrevious(settings);
  return { settingsFile: file, planned, current, currentIsOurs, savedPrevious: saved !== undefined && !isOurStatusLine(saved) ? saved : null, previous: current };
}

/** Thrown when install would replace a statusLine that isn't ours and the caller didn't confirm. */
export class NeedsConfirmError extends Error {
  constructor(readonly current: unknown) {
    super("settings.json already has a statusLine that isn't claude-code-super-statusline's; confirm to replace it (it is kept for uninstall)");
  }
}

export interface InstallResult {
  settingsFile: string;
  backup: string | null;
  /** The statusLine entry that was overwritten (ours or foreign), null when there was none. */
  replaced: unknown;
  /** True when settings.json already had exactly this entry — no write, no backup. */
  unchanged: boolean;
  statusLine: Record<string, unknown>;
}

export function install(opts: InstallOptions = {}): InstallResult {
  const plan = planInstall(opts);
  const settings = readSettings(plan.settingsFile);
  // Heal settings left by the old bug where PREVIOUS_KEY got our own stale command: restoring that on
  // uninstall would just reinstall us.
  const legacyOwnPrevious = isOurStatusLine(parkedPrevious(settings));
  // Parked by an older install under an earlier key name: this write moves it to PREVIOUS_KEY.
  const oldKey = LEGACY_PREVIOUS_KEYS.some((key) => settings[key] !== undefined);
  if (plan.currentIsOurs && JSON.stringify(plan.current) === JSON.stringify(plan.planned) && !legacyOwnPrevious && !oldKey) {
    return { settingsFile: plan.settingsFile, backup: null, replaced: null, unchanged: true, statusLine: plan.planned };
  }
  if (plan.current !== null && !plan.currentIsOurs) {
    if (!opts.confirmReplace) throw new NeedsConfirmError(plan.current);
    // The newest foreign choice wins: if the user switched to another statusline after installing us,
    // that is the one they'd want back.
    settings[PREVIOUS_KEY] = plan.current;
  } else if (legacyOwnPrevious) {
    delete settings[PREVIOUS_KEY];
  } else if (oldKey && settings[PREVIOUS_KEY] === undefined) {
    settings[PREVIOUS_KEY] = parkedPrevious(settings);
  }
  for (const key of LEGACY_PREVIOUS_KEYS) delete settings[key];
  settings.statusLine = plan.planned;
  const backup = writeSettings(plan.settingsFile, settings);
  return { settingsFile: plan.settingsFile, backup, replaced: plan.current, unchanged: false, statusLine: plan.planned };
}

export interface UninstallResult {
  settingsFile: string;
  /** The foreign statusLine put back, if one was parked. */
  restored: unknown;
  /** False when the current statusLine isn't ours — then nothing was changed. */
  removed: boolean;
  backup: string | null;
}

export function uninstall(): UninstallResult {
  const file = settingsPath();
  const settings = readSettings(file);
  if (!isOurStatusLine(settings.statusLine)) return { settingsFile: file, restored: null, removed: false, backup: null };
  const prev = parkedPrevious(settings);
  const restorable = prev !== undefined && prev !== null && !isOurStatusLine(prev);
  if (restorable) settings.statusLine = prev;
  else delete settings.statusLine;
  delete settings[PREVIOUS_KEY];
  for (const key of LEGACY_PREVIOUS_KEYS) delete settings[key];
  const backup = writeSettings(file, settings);
  return { settingsFile: file, restored: restorable ? prev : null, removed: true, backup };
}

/** Thrown by setRefreshInterval for a value Claude Code would not accept, or when there is nothing of ours to change. */
export class RefreshIntervalError extends Error {}

export interface RefreshIntervalResult {
  settingsFile: string;
  backup: string | null;
  /** The value now in settings.json; null = refresh only on session events. */
  refreshInterval: number | null;
  unchanged: boolean;
}

/**
 * Set (whole seconds, 1–3600) or clear (null) `refreshInterval` on our statusLine entry. Only ever
 * touches an entry that is ours: someone else's statusline is not ours to retime, and with none
 * installed there is nothing to retime at all.
 */
export function setRefreshInterval(seconds: number | null): RefreshIntervalResult {
  if (seconds !== null && (!Number.isInteger(seconds) || seconds < MIN_REFRESH_SECONDS || seconds > MAX_REFRESH_SECONDS)) {
    throw new RefreshIntervalError(`refreshInterval must be a whole number of seconds from ${MIN_REFRESH_SECONDS} to ${MAX_REFRESH_SECONDS}, or null`);
  }
  const file = settingsPath();
  const settings = readSettings(file);
  const current = settings.statusLine;
  if (!isOurStatusLine(current) || !isPlainObject(current)) throw new RefreshIntervalError("the statusline in settings.json is not claude-code-super-statusline's; apply it first");
  const before = typeof current.refreshInterval === "number" ? current.refreshInterval : null;
  if (before === seconds) return { settingsFile: file, backup: null, refreshInterval: seconds, unchanged: true };
  const next: Record<string, unknown> = { ...current };
  if (seconds === null) delete next.refreshInterval;
  else next.refreshInterval = seconds;
  settings.statusLine = next;
  const backup = writeSettings(file, settings);
  return { settingsFile: file, backup, refreshInterval: seconds, unchanged: false };
}

/**
 * Before 0.4.0 the plugin was called `ssp`, so a statusLine installed then runs
 * `…/plugins/cache/<marketplace>/ssp/…`. After installing the renamed plugin that command keeps
 * running the old version — and prints "plugin files not found" once the old plugin is removed — so
 * the configurator calls this on startup to point it at `entry` instead: the user's tweaks to the
 * entry are kept and a parked statusline is carried over (install does both).
 *
 * Only a plugin install takes over, and only from that old plugin path: a statusLine aimed at a
 * checkout is a developer's deliberate choice and stays. Returns null when there was nothing to do.
 */
export function adoptLegacyStatusLine(entry = defaultEntry()): InstallResult | null {
  if (!pluginCacheBase(entry)) return null;
  const current = readSettings(settingsPath()).statusLine;
  if (!isOurStatusLine(current) || !LEGACY_PLUGIN_CACHE.test((current as { command: string }).command)) return null;
  return install({ command: launcherCommand(entry) });
}
