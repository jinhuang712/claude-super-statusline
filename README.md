<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="docs/images/banner-light.png">
    <img alt="super-statusline — a Claude Code statusline you design in your browser, against your real session" src="docs/images/banner-dark.png">
  </picture>
</h1>

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/images/presets-light.png">
  <img alt="The three presets. Minimal: project, branch, model, context. Standard: adds rate-limit usage. Full: adds the diff, prompt cache, tokens and output speed" src="docs/images/presets-dark.png">
</picture>

<p align="center"><b><a href="https://jinhuang712.github.io/claude-code-super-statusline/">Try the configurator in your browser →</a></b><br>
the real one, running on a sample session</p>

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/jinhuang712/claude-code-super-statusline/main/install.sh | bash
```

Then run `/super-statusline:config` in Claude Code and pick a layout. The script checks for [Bun](https://bun.sh)
(and offers to install it); run it again any time to update. Installing by hand, uninstalling and upgrading:
[INSTALL.md](INSTALL.md).

## Drag and drop

Start from a preset, then arrange it by hand — the preview redraws as you go:

* **Drag a widget** from *Unused widgets* onto any line, left or right.
* **Drag it again** to reorder it, or to move it to another line — or focus it and press <kbd>Alt</kbd> + arrow keys.
* **Drag it back** to the tray to remove it (or click it and choose *Remove from statusline*).
- **Insert a line** anywhere: hover a line and click the ⊕ on its top or bottom edge, or click its line number and
  choose _Insert line above_ / _below_ (the same menu moves and deletes lines).

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/images/dnd-light.gif">
  <img alt="Recording: Lines changed dragged from the tray onto line 1, Session cost moved to line 2, Last reply dragged back to the tray — the statusline preview updates after each drop" src="docs/images/dnd-dark.gif">
</picture>

## What you can change

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/images/configurator-light.png">
  <img alt="The configurator: a live preview of the statusline, Style (theme, bar glyphs, progress bar mode, separator) and Layout presets" src="docs/images/configurator-dark.png">
</picture>

* **Layout** — *Minimal*, *Standard* or *Full*, or *Custom* to build your own lines by dragging.
* **Color theme** — default, nord, dracula, gruvbox, tokyo-night, catppuccin, mono.
* **Progress bars** — the bar glyphs: full block, tall, low, half, slanted, squares, line, dots.
* **Progress bar mode** — thresholds (green → yellow → red) or a smooth gradient.
* **Separator** — `│` `·` `•` `/` `|` `❯`, or your own.
* **Empty widgets** — what a labelled widget shows before it has data (`Name –`), or hide it as before.
* **Each widget** — in *Custom*, click a widget to change its label, colour, what it shows when empty, and options:

<img alt="A widget's options opened under its line: label, percentage, bar width, text colour, thresholds and toggles" src="docs/images/options-dark.png">

The preview shows your real session; hover a choice to try it before you click. English and 简体中文.

## Widgets

**Project · Git**

| Widget | Shows |
|---|---|
| Project path | The working directory — name only, last few folders, `~/…` or the full path |
| Worktree | The active git worktree, and the branch it came from |
| Added directories | Folders added with `/add-dir` |
| Repository | `owner/name` of the repo |
| Git branch | Branch, with `*` when there are uncommitted changes |
| Changes | Lines added / removed (by this session or uncommitted), the changed files (added, modified, deleted, renamed), commits ahead / behind |
| Pull request | The branch's open PR and its review state |

**Model · Context**

| Widget | Shows |
|---|---|
| Model badge | The model, with effort level, provider and fast mode if you like |
| Effort level | Reasoning effort as a symbol and/or word |
| Context usage | How full the context window is: bar, percentage, tokens |
| Prompt cache | Whether the prompt cache is warm, and when it expires |
| Cache misses | Cache misses out of all requests, and why the last one happened |
| Compactions | How many times the session was compacted |
| Over 200k tokens | A flag while the last request was over 200k tokens |

**Usage · Cost**

| Widget | Shows |
|---|---|
| Rate-limit windows | 5-hour, 7-day and spend-limit usage (Pro/Max), with reset times |
| Session tokens | Tokens used this session, subagents included, with an in/out/cache breakdown |
| Output speed | Tokens per second of the latest reply, subagents included |
| Session cost | What the session has cost |
| API time | Time spent waiting on the API |

**Session**

| Widget | Shows |
|---|---|
| Session name | The session's title |
| Session duration | Time since the session started |
| Session start | When the session started |
| Last reply | How long ago Claude last replied |
| API calls | Number of model turns |
| Session ID | The session id (short, or the full one `claude --resume` takes) |
| Agent name | The agent, when running with `--agent` |
| Vim mode | The current vim mode |

**Activity**

| Widget | Shows |
|---|---|
| Running agents | Subagents running right now |
| Todo progress | Todos done out of total, and the current one |
| Tool activity | The latest tool calls and how they went |
| MCP servers used | MCP servers called this session, failing ones flagged |

**Environment**

| Widget | Shows |
|---|---|
| Config counts | CLAUDE.md files, rules, MCP servers and hooks in effect |
| Output style | The output style, when it isn't the default |
| Thinking indicator | 💭 while extended thinking is on |
| Claude Code version | The Claude Code version |

**Other**

| Widget | Shows |
|---|---|
| Static text | Any text or symbol you type |
| Link | Clickable text |
| Environment variable | The value of a variable, e.g. `AWS_PROFILE` |
| Clock | The current time |

## In the desktop app

The desktop app has no `statusLine`, so the plugin also ships as a Claude Code *mod* (`hooks/`): a band above the
prompt, drawn by the same widget code, on the desktop app and in the terminal alike.

* **What it shows** — by default one row: short 5-hour and weekly rate-limit bars with their reset times on the left, the prompt-cache hit
  ratio, output speed and session cost on the right. The model, context and project are left out because the desktop
  app already shows them; tokens used and the rest are one click away in the panel.
* **Design it in the panel** — *Layout → Desktop app* edits the band's own layout (saved as `desktop.lines`, apart
  from the terminal's `lines`) with the same drag and drop, from the six widgets a mod can draw: rate-limit windows
  (all or one), session cost, prompt cache, session tokens and output speed. The mod re-reads the file as it changes.
  The preview draws it as text; the app itself draws the bars as coloured blocks.
* **What it counts itself** — a mod cannot read the statusline payload, so tokens, cache hits and speed are counted
  from each model request since the session started (a restart begins again from zero).
* **Limits** — a mod cannot import Node modules, so the widgets that read files or run git (project path, branch,
  changes, session cost estimates) are not available in it yet, and the Style settings (theme, bars, separator) do not
  apply to it.
* **Tests** — `scripts/test-mod.sh` runs `hooks/*.test.ts` with `claude plugin test`; `bun test` skips `hooks/`.

## More

* [INSTALL.md](INSTALL.md) — install, uninstall, upgrading from claude-code-ssp
* [ADVANCED.md](ADVANCED.md) — the config file, command line, your own widgets, security, development
* [DESIGN.md](DESIGN.md) — how it works inside
* [CHANGELOG.md](CHANGELOG.md)

## License

MIT. `src/data/` is derived from [claude-hud](https://github.com/jarrodwatts/claude-hud) © Jarrod Watts, MIT.
