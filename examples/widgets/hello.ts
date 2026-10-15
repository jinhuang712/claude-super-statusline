/**
 * Example user widget. Copy this file to ~/.config/claude-super-statusline/widgets/ (or <project>/.claude/claude-super-statusline/widgets/),
 * restart `claude-super-statusline serve`, and it appears in the picker under "misc".
 *
 * A widget module's default export is one definition or an array of them. `render` must be fast and pure:
 * it runs on every statusline refresh. Throwing is safe — the line shows a dim "⚠ id" instead of blanking.
 */
export default {
  id: "example.hello",
  name: "Hello",
  description: "Greets you and shows how many todos are done. Demonstrates options, theme tokens and thresholds.",
  category: "misc",
  sample: "👋 you · 3/7",
  schema: {
    type: "object",
    properties: {
      name: { type: "string", title: "Name", default: process.env.USER ?? "friend" },
      showTodos: { type: "boolean", title: "Show todo ratio", default: true },
    },
  },
  defaults: { name: process.env.USER ?? "friend", showTodos: true },
  render(ctx: any, opts: { name: string; showTodos: boolean }, api: any) {
    const segs = [api.seg(`👋 ${opts.name}`, { fg: "accent" })];
    if (opts.showTodos && ctx.transcript.todos.length) {
      const done = ctx.transcript.todos.filter((t: { status: string }) => t.status === "completed").length;
      const pct = (done / ctx.transcript.todos.length) * 100;
      segs.push(api.seg(` · ${done}/${ctx.transcript.todos.length}`, { fg: api.level(100 - pct, 50, 90) }));
    }
    return segs;
  },
};
