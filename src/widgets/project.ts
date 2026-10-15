import * as os from "node:os";
import { defineWidget } from "../core/types.js";
import { sanitizeDisplayText } from "../data/utils/sanitize.js";
import { stdin } from "./_shared.js";

function formatPath(cwd: string, levels: "1" | "2" | "3" | "full" | "tilde"): string {
  const safe = sanitizeDisplayText(cwd);
  if (levels === "full") return safe;
  if (levels === "tilde") {
    const home = os.homedir();
    return safe.startsWith(home) ? `~${safe.slice(home.length)}` : safe;
  }
  const segs = safe.split(/[\\/]/).filter(Boolean);
  return segs.slice(-Number(levels)).join("/") || safe;
}

export const projectPath = defineWidget<{ dir: "current" | "launch"; levels: "1" | "2" | "3" | "full" | "tilde"; link: boolean; icon: string }>({
  id: "project.path",
  name: "Project path",
  description: "Working directory, as basename, N trailing segments, ~-relative or full path.",
  category: "project",
  sample: "~/dev/claude-super-statusline",
  schema: {
    type: "object",
    properties: {
      // workspace.project_dir is where Claude Code was launched; it stays put when the session cd's
      // into a subfolder, so "launch" names the project rather than wherever the shell wandered.
      dir: { type: "string", enum: ["current", "launch"], default: "current", title: "Directory" },
      levels: { type: "string", enum: ["1", "2", "3", "tilde", "full"], default: "1", title: "Path depth" },
      link: { type: "boolean", default: true, title: "Clickable (OSC 8 file link)" },
      icon: { type: "string", default: "", title: "Icon prefix" },
    },
  },
  defaults: { dir: "current", levels: "1", link: true, icon: "" },
  render(ctx, o, api) {
    const s = stdin(ctx);
    const current = s.workspace?.current_dir ?? s.cwd;
    const cwd = o.dir === "launch" ? (s.workspace?.project_dir ?? current) : current;
    if (!cwd) return null;
    const text = `${o.icon ? `${o.icon} ` : ""}${formatPath(cwd, o.levels)}`;
    const seg = api.seg(text, { fg: "project" });
    if (o.link) seg.link = `file://${encodeURI(cwd)}`;
    return [seg];
  },
});

export const projectAddedDirs = defineWidget<{ max: number }>({
  id: "project.addedDirs",
  name: "Added directories",
  description: "Directories added with /add-dir.",
  category: "project",
  sample: "+lib-foo +shared",
  schema: { type: "object", properties: { max: { type: "integer", default: 3, minimum: 1, title: "Max shown" } } },
  defaults: { max: 3 },
  render(ctx, o, api) {
    const dirs = stdin(ctx).workspace?.added_dirs ?? [];
    if (!dirs.length) return null;
    const shown = dirs.slice(0, o.max).map((d) => `+${sanitizeDisplayText(d.split(/[\\/]/).filter(Boolean).pop() ?? d)}`);
    const more = dirs.length - shown.length;
    return [api.seg(shown.join(" ") + (more > 0 ? ` +${more} more` : ""), { fg: "muted" })];
  },
});

export const projectWorktree = defineWidget<{ showOriginal: boolean }>({
  id: "project.worktree",
  name: "Worktree",
  description: "Name of the active git worktree session, and optionally the branch it was entered from.",
  category: "project",
  sample: "⎇ my-feature",
  schema: {
    type: "object",
    properties: {
      // worktree.original_branch: only Claude Code's own worktree sessions report it (not hook-based
      // ones, and not a plain `git worktree` the session merely sits in), so the arrow can be absent.
      showOriginal: { type: "boolean", default: false, title: "Show the branch it came from (← main)" },
    },
  },
  defaults: { showOriginal: false },
  render(ctx, o, api) {
    const s = stdin(ctx);
    const name = s.worktree?.name ?? s.workspace?.git_worktree;
    if (!name) return null;
    const segs = [api.seg(`⎇ ${sanitizeDisplayText(name)}`, { fg: "git" })];
    const from = s.worktree?.original_branch;
    if (o.showOriginal && from) segs.push(api.seg(` ← ${sanitizeDisplayText(from)}`, { fg: "muted" }));
    return segs;
  },
});

export const projectSessionName = defineWidget<Record<string, never>>({
  id: "project.sessionName",
  name: "Session name",
  description: "Custom or AI-generated session title.",
  category: "session",
  sample: "refactor-auth",
  schema: { type: "object", properties: {} },
  defaults: {},
  render(ctx, _o, api) {
    const name = stdin(ctx).session_name ?? ctx.transcript.sessionName;
    return name ? [api.seg(sanitizeDisplayText(name), { fg: "accent" })] : null;
  },
});
