/**
 * The product's name on disk, and the names it had before.
 *
 * Folders and files are named after the product (claude-super-statusline). It was called
 * claude-code-super-statusline from 0.4.0 to 0.5.x and claude-code-ssp before that, and installs from
 * those versions keep their folders under the old names, so every folder we own is resolved through
 * adoptLegacyDir, which moves the newest old one over the first time the new version looks for it.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export const APP_NAME = "claude-super-statusline";
/** The names it had before, newest first. Still found on disk in configs, caches and settings.json. */
export const LEGACY_APP_NAMES = ["claude-code-super-statusline", "claude-code-ssp"] as const;
/** The name just before this one; `claude-code-ssp`, from before 0.4.0, is the last of LEGACY_APP_NAMES. */
export const LEGACY_APP_NAME = LEGACY_APP_NAMES[0];

/**
 * The old spellings of `parent/APP_NAME/...rest`, newest first: the same path with each earlier
 * product name in place of APP_NAME. For adoptLegacyDir and newOrLegacy, which take them in order.
 */
export function legacyPaths(parent: string, ...rest: string[]): string[] {
  return LEGACY_APP_NAMES.map((name) => path.join(parent, name, ...rest));
}

/**
 * For the files a *project* keeps under `.claude/` (its config overlay, its widgets folder), which
 * are never moved: they may be committed to someone's repo, and renaming them is that team's call.
 * The newest old path that exists when the new one does not — so reads and saves both go to the file
 * the project already has — otherwise the new one (it wins when both exist).
 */
export function newOrLegacy(p: string, ...legacyPs: string[]): string {
  if (fs.existsSync(p)) return p;
  return legacyPs.find((legacy) => fs.existsSync(legacy)) ?? p;
}

let movesAllowed = true;

/**
 * Stop adoptLegacyDir from moving anything in this process; it then just points at the old folder.
 * For `serve --sandbox`, which must only ever *read* the real folders: moving them would pull the
 * config out from under an older install that is still the live statusline.
 */
export function freezeLegacyDirs(): void {
  movesAllowed = false;
}

/**
 * `dir`, after moving the newest of `legacyDirs` there when only old ones exist. Callers pass
 * siblings (same parent, only the last segment differs), so a rename is enough — no copy, nothing
 * half-moved. When several old folders exist (a machine that was never opened between two
 * renames), the newest is adopted and the older one is left where it is.
 *
 * Returns the old folder when the move failed and it is still there (a permission problem, a Windows
 * lock): reading it where it is beats starting from defaults and leaving the user's layout, counter
 * resets and snapshots behind. Likewise after freezeLegacyDirs. Cheap enough for the render path:
 * after the first run it is a single existsSync.
 */
export function adoptLegacyDir(dir: string, ...legacyDirs: string[]): string {
  if (fs.existsSync(dir)) return dir;
  const legacyDir = legacyDirs.find((legacy) => fs.existsSync(legacy));
  if (!legacyDir) return dir;
  if (!movesAllowed) return legacyDir;
  try {
    fs.renameSync(legacyDir, dir);
    return dir;
  } catch {
    // Two renders can race here: the loser's rename fails because the winner already moved the
    // folder, and `dir` exists now. Anything else means the move is impossible; keep the old one.
    return fs.existsSync(dir) ? dir : legacyDir;
  }
}
