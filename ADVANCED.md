# Claude Super Statusline for power users

Everything the configurator page does can also be done by hand. For how it works inside, see [DESIGN.md](DESIGN.md).

## Config file

The page writes `~/.config/claude-super-statusline/config.json`. A project can override it with
`.claude/claude-super-statusline.json` (choose which one the page saves to in its header). Objects merge,
`lines` and `desktop.lines` replace wholesale, and both files are re-read on every refresh. The folder was
`~/.config/claude-code-super-statusline/` before the rename and is moved on the first run; `CLAUDE_SUPER_STATUSLINE_CONFIG`
points at another file (`CLAUDE_CODE_SUPER_STATUSLINE_CONFIG`, its old name, still works).

```jsonc
{
  "theme": "tokyo-night",       // default | nord | dracula | gruvbox | tokyo-night | catppuccin | mono | {…inline}
  "colorLevel": "auto",         // auto | truecolor | 256 | 16 | none
  "colorMode": "gradient",      // thresholds | gradient — how every bar and percentage is coloured
  "separator": " │ ",
  "columnsOffset": 4,           // cells left free for Claude Code's own footer padding
  "emptyText": "–",             // a labelled widget with no data yet shows "Name –"; "" (default) hides it
  "lines": [
    { "left":  [{ "widget": "project.path", "options": { "levels": "tilde" } }, { "widget": "git.branch" }],
      "right": [{ "widget": "model.badge" }, { "widget": "cost.session" }] },
    { "left":  [{ "widget": "usage.windows", "options": { "bar": true } }],
      "right": [{ "widget": "context.bar" }], "overflow": "wrap" }
  ],
  "git": { "enabled": true, "cacheMs": 2000 },
  "plugins": { "dirs": [], "trustedProjects": [] },
  "captureSamples": true
}
```

A widget is `{ "widget": "<id>", "options": {…}, "style": { "fg", "bg", "bold", "dim", "italic", "underline" }, "label": "…" | null, "emptyText": "…" | null }`.
Colours are theme tokens (`fg muted accent ok warn crit model project git usage context`), literals (`#rrggbb`,
`208`, `red`) or `default`, the terminal's own colour.

A widget with no data (no session name yet, no usage limits before the first reply) is hidden, label and all.
`emptyText` shows a placeholder instead: the config-wide one fills in every widget that has a label, and a
widget's own `emptyText` overrides it — shown even without a label, and `""` or `null` keeps that widget hidden.

## Command line

From a checkout (`bun install` first), `bun src/cli/main.ts <command>`:

| Command | Does |
|---|---|
| `render` | Reads Claude Code's JSON on stdin and prints the statusline (what Claude Code runs) |
| `render --fixture src/fixtures/basic.json` | Prints the statusline for a sample session |
| `serve [--port N] [--open]` | Starts the configurator |
| `serve --sandbox` | The configurator on `:4878`, against throwaway copies of your settings |
| `install [--dry-run] [--replace]` | Turns the statusline on in `~/.claude/settings.json` (`--replace` if another one is set; it is kept) |
| `uninstall` | Turns it off and restores the statusline it replaced |
| `reset [--session ID] [--undo]` | Restarts a session's cost, token, API-call and line counters from zero (also *⋯ → Reset counters*) |
| `doctor` | Shows the same diagnostics as *⋯ → Diagnostics* |

## Your own widgets

Drop a `.ts` or `.js` file in `~/.config/claude-super-statusline/widgets/` and restart the configurator. It
appears under *Unused widgets*; the statusline picks it up right away.

```ts
export default {
  id: "example.hello", name: "Hello", description: "Says hello", category: "misc",
  schema: { type: "object", properties: { name: { type: "string", default: "friend" } } },
  defaults: { name: "friend" },
  render(ctx, opts, api) {                    // ctx: stdin, transcript, gitStatus, columns, now, theme …
    return [api.seg(`👋 ${opts.name}`, { fg: "accent" })];
  },
};
```

A widget that throws shows `⚠` instead of blanking the line. More in [`examples/widgets/`](examples/widgets/), the
built-ins in [`src/widgets/`](src/widgets/), and the widget contract in [DESIGN.md](DESIGN.md#widget-contract-srccoretypests).

## Security

* The configurator listens on `127.0.0.1` only, and answers only requests whose `Host` and `Origin` are its own:
  other websites can't read your sessions or change your settings.
* A project's own widgets (`<project>/.claude/claude-super-statusline/widgets/`) are code, so they load only for
  projects listed in `plugins.trustedProjects` of your *user* config (*⋯ → Diagnostics → Trust this project*). A
  project's config can't trust itself.
* The preview renders only captured sessions and bundled samples, never a path a request supplies.

## Development

```bash
bun install
bun test
bun run typecheck
bun run serve:sandbox     # the configurator against throwaway copies of your settings
bun run dev:web           # Vite on :5178, proxying /api → :4877 (run `bun run serve` alongside)
bun run build:web         # rebuild web/dist — it is committed, so installs need no build
scripts/ui-smoke.sh       # headless browser check of the configurator (playwright-cli)
bun run site              # build the GitHub Pages site into site/dist and serve it on :4880
```

The site is one page: the three presets rendered by the real engine, the drag-and-drop recording, and the real
configurator mounted inside it (desktop only), built by `web/vite.demo.config.ts` with its API running in the browser
(`site/demo/api.ts`) against a sample session precomputed by `site/build.ts`.
