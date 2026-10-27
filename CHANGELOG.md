# Changelog

Versions follow the plugin manifest (`.claude-plugin/plugin.json`); marketplace installs update when it changes.

## 0.6.3 — 2026-10-28

- **The desktop band is switched off.** It is no longer drawn above the prompt, and the panel's _Terminal | Desktop
  app_ switch is gone, so the panel edits the terminal layout only. A saved `desktop.lines` is left untouched. The code
  is kept behind two switches (see the README's desktop section).

## 0.6.2 — 2026-10-28

- **"Rate-limit windows" can show the 7-day pace.** Switch on _Show 7-day pace_ and the 7d figure is followed by
  `pace 71%`: how much of the week you would have used by now if you spent it evenly (100/7 = 14.3% a day). It turns
  yellow when you are above it. Off by default.

## 0.6.1 — 2026-10-18

- **The band above the prompt is drawn in the desktop app only.** In the terminal the statusline under the prompt
  already shows the same figures, so the band no longer adds a second row of them above it.
- **Prompt cache and Output speed are coloured.** The `cache` label is in the accent; the countdown takes the dot's
  colour (green, yellow in the last minute); the hit ratio is green, yellow below 70% and red below 40% (in the
  gradient progress-bar mode too); `tok/s` is in the usage colour. All four were grey before.

## 0.6.0 — 2026-10-16

- **In a narrow pane (a split view, a small window) the desktop band moves whole widgets to another row** instead of
  breaking their text mid-phrase; widgets are spaced by a gap rather than a `│`.
- **Renamed: Claude Super Statusline.** It is no longer only for Claude Code, so *claude-code-super-statusline* is now
  *claude-super-statusline*: the repository, the demo site (`jinhuang712.github.io/claude-super-statusline/`), the clone
  directory, the CLI's messages and the folders it keeps on disk (`~/.config/claude-super-statusline`,
  `~/.claude/plugins/claude-super-statusline`, `.claude/claude-super-statusline.json`). **Nothing to do on your side:** the first
  run moves an existing config, caches and parked statusline over (whichever of the two older names they are under), a
  project's old overlay file or widgets folder is read and saved where it is, `CLAUDE_CODE_SUPER_STATUSLINE_CONFIG` and
  `…_DEBUG` still work (the new `CLAUDE_SUPER_STATUSLINE_*` win), and the old GitHub address redirects. The plugin id
  (`super-statusline`, `/super-statusline:config`) and the marketplace id (`claude-code-super-statusline`) are unchanged, so
  an installed plugin stays enabled and keeps updating. The old demo-site address does not redirect.
- **The panel says "live in Claude"**, not "in Claude Code", since a saved layout now reaches the desktop app too; the
  wordmark's cursor blinks for as long as the page is open, and a click on it pauses it (remembered).
- **The desktop band no longer draws the bar's filled part as an invisible gap** when its colour is a terminal name such
  as `brightBlue`: ANSI names are drawn as hex.
- **README, docs and the landing page** describe both places it shows up, with new screenshots of the panel's *Desktop
  app* tab and of the band in the desktop app.
- **A band above the prompt for the desktop app.** The plugin is now also a Claude Code mod: rate-limit bars, session
  cost, prompt-cache hit ratio, tokens and output speed, drawn above the prompt in the desktop app and the terminal.
  The CLI statusline is unchanged. The *Terminal | Desktop app* switch beside the preview designs the band: its own `desktop.lines`,
  drag and drop, with the widgets a mod can draw.

## 0.5.3 — 2026-09-29

- **A right-aligned widget stays right-aligned on a row of its own.** Claude Code trims every line of the
  statusline, so a row with nothing on the left — the model badge beside a session name that a new session does
  not have yet — lost its padding and showed at the left edge. Such rows now keep it.
- **Empty widgets can keep their label.** A widget with no data yet (the session name, usage limits and the
  prompt cache in a new session) used to vanish, label and all, and rows came and went after the first reply.
  *Style → Empty widgets* sets what a labelled widget shows instead — `Name –`, `…`, `n/a` or your own text —
  and a widget's own *When empty* overrides it or keeps it hidden. The default is still to hide it.
- **Insert a line above or below.** A ⊕ on a line's edge, or the line-number menu, adds an empty line there.

## 0.5.2 — 2026-09-28

- **Lines changed is now Changes, and it holds everything that changed.** Besides the lines added / removed
  (which can now be turned off), it shows the changed files from `git status` — *Count* (`4 files`), *Letters*
  (`4 files A1 M2 D1 R1`: added, modified, deleted, renamed; new untracked files count as added) or *Symbols*
  (`!2 +1 ✘1 ?1`, as Git branch showed them, now with `→N` for renames) — and the commits ahead of / behind the
  upstream (`↑2 ↓1`).
- **Git branch keeps only the branch.** Its *Show ↑N ↓N* and *Show !M +A ✘D ?U* moved to Changes. Existing
  statuslines are carried over on the first read: a Changes widget on the same line takes them, otherwise one showing
  only them is added right after the branch. Minimal, Standard and the default layout include that widget too, so
  nothing disappears and a preset layout still matches its preset. On a line where Changes sits in another zone,
  ↑N ↓N and the file stats now show where Changes is; drag it next to the branch to have them there again.
- **The statusline refreshes on a timer.** Claude Code re-runs a statusline only when something happens in the
  session, so a change saved in the page used to show up only after the next message. Applying the statusline now
  sets it to refresh every 5 seconds as well, and *⋯ → Refresh* changes that (1, 5, 10 or 30 s, or only on new
  messages). A statusline applied by an earlier version has no timer until you pick one there.

## 0.5.1 — 2026-09-28

- **Session tokens counts subagents.** Claude Code writes each subagent's (Task / Agent tool, workflow agents too)
  records to its own file under `<session>/subagents/`, so the total only ever showed the main conversation — on one
  real session 55M of the 80M spent. Their usage is now added by default; *Include subagents* turns it off. Session
  cost and API calls still count the main conversation only (the cost estimate is priced at the main model's rates).
  Counters reset from now on reset subagent tokens too; a reset made before 0.5.1 shows every subagent token since
  the session started.
- **Output speed measures subagent replies too.** It shows the latest long-enough reply from the main conversation
  or any subagent, each timed on its own chain, instead of staying on the main conversation's last reply while
  agents work.

## 0.5.0 — 2026-09-26

- **One colour mode for every progress bar.** Thresholds or gradient used to be picked per widget (*Colour* on
  Context usage, Context value and both rate-limit widgets); it is now a single `colorMode` setting that all of them
  follow. Existing configs carry over: if any widget was set to the gradient, the whole statusline is (so a config that
  mixed the two becomes all-gradient), otherwise it stays on thresholds. The Full preset no longer turns the gradient
  on by itself. Plugins can colour a percentage the same way with `api.levelColor`.
- **Style → Progress bar mode.** The setting sits next to the bar glyphs, drawn as a bar in each mode's colours,
  and tries itself on in the preview like the theme and separator do. Under the gradient a widget's *Yellow at %*
  is dimmed and says it needs Thresholds.
- **`/super-statusline:reset` is gone.** Resetting the session counters is still in the panel (*⋯ → Reset counters*,
  for the session it previews) and in the CLI (`reset [--session ID] [--undo]`); counters already reset stay reset.
- **An install script that also updates.** `curl -fsSL …/install.sh | bash` checks Claude Code (2.1.251+) and Bun
  (1.1+), offers to install Bun with its official installer when it is missing, and then installs the plugin — or,
  when it is already installed, updates the marketplace and the plugin. See INSTALL.md.
- **The Standard preset no longer shows the session cost.** It is project, branch and model over usage limits and
  context; cost is still in Full and in the tray. A statusline set up from the old Standard keeps its cost widget
  (the panel now shows it as Custom).
- **`/super-statusline:config` finds a Bun installed mid-session** in `~/.bun/bin`, instead of saying "bun not found"
  until Claude Code is restarted.
- **A website: [jinhuang712.github.io/claude-code-super-statusline](https://jinhuang712.github.io/claude-code-super-statusline/).**
  The three presets rendered by the real engine, the drag and drop, the install command, and the real configurator
  running in the page on a sample session (desktop only; your changes stay in that browser). In English and 中文,
  light and dark. The README links to it.

## 0.4.1 — 2026-09-24

- **The header carries the new name.** "Claude Code statusline" with ✻ became a wordmark: `❯ super-statusline` in mono
  with "super" in clay, a block cursor that blinks four times and then stays (never with reduced motion), and a hairline
  in the widget colours under the name. The favicon and the first-run welcome use the same prompt.

## 0.4.0 — 2026-09-24

- **Renamed: claude-code-ssp is now claude-code-super-statusline.** The plugin is `super-statusline@claude-code-super-statusline`,
  the commands are `/super-statusline:config` and `/super-statusline:reset`, and the repo moved to
  `github.com/jinhuang712/claude-code-super-statusline` (the old URL redirects). An installed `ssp` plugin doesn't turn
  into the new one by itself: see *Upgrading from claude-code-ssp* in the README (install the new plugin, run
  `/super-statusline:config` once, remove the old one). Environment variables are renamed too
  (`CLAUDE_CODE_SUPER_STATUSLINE_CONFIG`, `CLAUDE_CODE_SUPER_STATUSLINE_DEBUG`, `SUPER_STATUSLINE_PORT`); the old
  names are no longer read.
- **Your folders move to the new name.** `~/.config/claude-code-ssp/` (config, your widgets) and
  `~/.claude/plugins/claude-code-ssp/` (session snapshots, counter resets, caches) become
  `…/claude-code-super-statusline/` the first time the new version runs. If the move can't happen, the old folder
  keeps being used. `serve --sandbox` never moves them.
- **Project files: new name, old one still works.** A project's overlay is `.claude/claude-code-super-statusline.json`
  and its widgets `.claude/claude-code-super-statusline/widgets/`. A project that has the old
  `claude-code-ssp` file or folder keeps using it (reads and saves go there): those may be committed, so they are
  never moved. *Save as project config* names the file it will write.
- **The statusline setting follows the rename.** Opening the configurator from the new plugin points a statusLine that
  still runs the old `ssp` plugin at the new one, keeping your tweaks to it. The statusline it replaced (claude-hud, a
  script…) stays parked, now under `statusLine.previous.claude-code-super-statusline`, and *Stop using this statusline*
  still brings it back. A statusLine aimed at a checkout is left alone.

## 0.3.3 — 2026-09-24

- **Preview settings look like the rest of the page.** Width, terminal, colors and snapshots are the same
  segmented switches as the header's language and appearance; right margin and fixed columns are a − n +
  stepper. No more native dropdowns, number boxes or checkbox, and the hints are shorter.

## 0.3.2 — 2026-09-24

Everything Claude Code documents for the statusline now has a widget or an option.

- **Session ID** (`session.id`): the first 8 characters of the session's id, or the whole id — the one
  `claude --resume` takes.
- **Over 200k tokens** (`context.over200k`): a `200k+` flag while the last request carried more than 200k tokens.
  The line is fixed, so on a 1M window it shows well before the context bar looks full.
- **Cache misses** (`context.cacheMisses`): prompt cache misses out of all requests, with the likely cause of the
  last one — `miss 2/14 (tools changed)` — and, if you like, the tokens they re-cached. Hidden while there are none.
- **Prompt cache** can show the lifetime its countdown runs from (`● 42m/1h`) and what a cold cache would
  re-cache on the next request (`↻45k`).
- **Project path** can name the directory Claude Code was started in instead of the current one, so a session
  that `cd`s into a subfolder still shows the project.
- **Worktree** can show the branch the worktree session was entered from (`⎇ my-feature ← main`).

Left out on purpose: `prompt_id` (a UUID for matching telemetry, nothing to read at a glance), `transcript_path`
(read behind the scenes, not shown) and the finer cache counters (`expected_rebuilds`, `cache_write_tokens`,
`miss_causes`).

## 0.3.1 — 2026-09-24

The viewer's own settings in the header, fewer duplicate widgets, and two page-feel fixes.

- **Language switch in the header:** EN / 中文, beside the ⋯ menu. It leaves the menu, where it was a dropdown
  you had to read the current language to find.
- **Appearance switch in the header** too: system / light / dark, as three icons next to the language. The ⋯
  menu now holds only the rare actions (re-apply, reset counters, project config, diagnostics, stop using).
- **"Single rate-limit window" leaves the tray.** "Rate-limit windows" shows the same with 7d and spend switched
  off. Lines that already use it keep working and can still be edited.
- **"Context value" and "Current context tokens" leave the tray too:** Context usage shows the percentage with its
  bar off, and the tokens with "Show used/total tokens". Lines that use them keep working.
- "Context bar" is now called **Context usage** (上下文用量): with "Show bar" off it is the percentage alone, so
  "bar" undersold it. Its id, `context.bar`, is unchanged.
- The **Minimal** preset shows its context figure with Context usage (bar off) instead of Context value. It prints
  the same `ctx 32%`; a layout picked from the old Minimal now shows as Custom.
- The page no longer rubber-bands past its top or bottom on a trackpad, which dragged the pinned header down
  and left a gap above it.
- Opening the preview settings or the ⋯ menu with the mouse no longer lights up its first control ("Fit to
  window" looked selected). Opened from the keyboard, focus still lands on it.

## 0.3.0 — 2026-09-23

A simpler configurator: the page is the layout and the style, and everything else is one click away.

- **Widgets are added from a tray** of unused ones under the layout, one group per row: click to append to the
  last line, drag to put one anywhere, drag a chip back onto the tray (or press Delete) to remove it. It replaces
  the "+" in every zone and the picker drawer.
- **Options open in place**, under the widget's own line, instead of in a side drawer. Values are a row of choices;
  booleans are one group of toggles; warn/crit thresholds are one band.
- **Presets come first:** Minimal, Standard, Full or Custom, as cards at the top of Layout. The line editor and the
  widget tray belong to Custom; a custom layout is kept while you look at a preset and comes back with Custom.
  **Full** is a new layout: project and session name · model / repo, branch and lines changed · context bar /
  usage · prompt cache / cost and tokens · output speed, with gradient colours and bars (it had session
  times, agents and todos).
  **Style** is three summaries (theme, bar, separator) that open their choices in place.
- **Off the page:** render settings (width, terminal ground, right margin, colour mode, snapshots) sit behind the
  preview's sliders button; re-apply, reset counters, project config, diagnostics, "stop using", language and
  appearance behind the header's ⋯ menu. The Advanced and Diagnostics sections, the footer and the center-zone
  toggle are gone (a config that already uses the center zone stays editable).
- Chips show just the widget's name; surfaces are separated by fill rather than borders (80 outlined elements on
  the page before, 2 now).
- **The preview is part of the page.** No terminal window around it any more (border, title bar, black ground,
  mock prompt): a small *Preview* label with the column count and settings, the lines on the same fill as the
  layout rows, the note under them. "Trying on …" shows beside the label. A dark or light terminal picked in the
  preview settings still gets its own ground.
- **Everything is 10% larger**, and the preview's lines a little more (13px → 16px). Sizes now follow your
  browser's font-size setting too.
- **The preview follows your session.** `/ssp:config` opens the page bound to the session you ran it in, and the
  preview's data picker is gone (without a session it shows the most recent one).
- **No undo.** The Undo button, Ctrl/⌘+Z and the "… — Ctrl/⌘+Z to undo" toasts are gone: they were more noise
  than help. Edits still save on their own; a custom layout survives a trip to a preset within the page view.
- **The right side of a line never moves.** When a line is too long, the left side is now cut short with `…` so
  every line stays one row, and the right side keeps its place at the end of it. Per line you can have the left
  side continue on the next row instead (breaking between widgets). Before, the right side dropped to a row of
  its own. "Hide the right side" is no longer offered (configs that use it keep working). A line with widgets
  on one side only follows the same rules; before, it was never cut and the terminal broke it mid-word.
- **Gradient colours read on light terminals.** The gradient colour mode (context bar, usage) started at pure
  white and stayed pastel up to 70%, so a low bar or percentage all but vanished on a white terminal. Every stop
  is now a mid-tone that clears 3:1 on white, slate and black; on dark terminals the colours are a little less bright.

## 0.2.2 — 2026-09-23

A redesign of the web configurator in Claude Code's own design language.

- Warm ivory/slate surfaces, one clay accent, serif titles, soft corners, the ✻ mark and a clay favicon.
  The panel's accent no longer changes with the statusline theme (a yellow or grey theme took the focus
  rings and the Apply button's contrast with it); themes show their colours in their swatches and the preview.
- The preview draws the statusline under a mock Claude Code prompt, and its toolbar controls have labels.
- Presets are cards with a sketch of each layout; theme, bar style and separator are one *Style* card; the
  layout editor is one card with category dots on the chips.
- Option values read like a Claude Code menu (`❯` marks the current one); the picker has a search field.
- Accessibility: every text colour checked for WCAG AA in both schemes, input edges at 3:1, choices expose
  their state (`aria-pressed`), the page has a `<main>` landmark, the chip × no longer fades out, and long
  widget names truncate instead of clipping on a phone.

## 0.2.1 — 2026-09-23

A sweep of every widget option against real sessions, and fixes for everything that didn't work.

- **Output speed (tok/s) works.** It never showed: the claude-hud tracker it relied on needs renders while a
  response streams, which Claude Code doesn't do. It now measures the latest response from the transcript
  (end to end, replies under 200 tokens skipped).
- Labels never run into their value (`Compacted 2`, not `Compacted2`); `custom.env` gets a *Show NAME=* toggle
  and says when no variable is set.
- MCP count includes servers from enabled and claude.ai-synced plugins.
- Cost and the provider label agree on Bedrock/Vertex (env switch or model id).
- Agent models read `opus 5.5` instead of `claude-opus-5-5[1m]`.
- `git.repo` falls back to `origin` in `.git/config` when Claude Code doesn't send the repo.
- Options that only act with another option on are dimmed with a reason in the panel.
- Built-in samples include a sample transcript (agents, todos, tools, MCP, speed preview) and a Bedrock session;
  live samples are no longer padded with made-up values.
- Input without a `session_id` is no longer saved as an "unknown" session.
- A helper exported from a widget module can no longer crash the statusline at startup.
- New `tests/option-sweep.test.ts` keeps every option working.

## 0.2.0 — 2026-09-23

### Safer by default
- The configurator only answers its own page: Host/Origin checks, no CORS, JSON-only writes, 1 MB cap.
  Other websites can no longer read your sessions or rewrite `settings.json`.
- A project's own widgets (code that runs on every refresh) load only for projects you trust in your user config.
- Installing asks before replacing another statusline (claude-hud, a script…); the old one is kept, and
  *Advanced settings → Stop using this statusline* restores it. `uninstall` never removes a statusline that isn't ours.
- The saved statusLine command survives `brew upgrade` and plugin updates.
- The panel saves only what you changed: defaults are no longer frozen into your config, and a project's settings
  no longer leak into your user file. The session you preview decides which project a project-level save goes to.

### Web configurator
- English and 简体中文 (browser-detected, switcher in the footer); light and dark themes.
- Every option previews in colour against your real session; on/off options show both outcomes.
- Hover or focus a preset, theme, bar style or separator to try it on before applying.
- Keyboard: no more Tab trap in the preview; Alt+Arrow keys move widgets; drawers are proper dialogs.
- Works at half-screen and phone widths; readable contrast; a first-run guide; honest save status.
- Sessions grouped by project; a dark/light terminal background for the preview.
- The built UI ships with the plugin — no build step on first `/ssp:config`.

### Statusline
- Plain values use the terminal's own foreground in every theme (readable on light terminals).
- ~25 ms per render even on 100 MB transcripts once the first parse is done (new messages are parsed
  incrementally; the very first render of a huge transcript still takes a few hundred ms). Slow git no longer
  delays the line: a stale-but-cached status shows while a background refresh catches up.
- Truncation keeps colours and links intact; emoji and wide characters are measured correctly.
- `/ssp:reset` resets the session it was run from.

### Removed
- The npm `bin` launcher and `dist/` bundle: the plugin runs from source with Bun (marketplace only).

## 0.1.0

Initial release.
