# Installing super-statusline

## Requirements

* Claude Code 2.1.251 or later
* [Bun](https://bun.sh) on your `PATH`

## Install

### With the install script

```bash
curl -fsSL https://raw.githubusercontent.com/jinhuang712/claude-super-statusline/main/install.sh | bash
```

It checks your Claude Code version and that Bun is installed (and offers to install Bun if it isn't), then adds
the marketplace and installs the plugin. To install Bun without being asked, add `-s -- --yes` after `bash`. Rather
read it first? It's [`install.sh`](install.sh) in this repo.

Then, in Claude Code, run `/super-statusline:config` and pick a layout.

### By hand

1. Add the marketplace:
   ```bash
   claude plugin marketplace add jinhuang712/claude-super-statusline
   ```
2. Install the plugin:
   ```bash
   claude plugin install super-statusline@claude-code-super-statusline
   ```
3. In Claude Code, run:
   ```
   /super-statusline:config
   ```
   A page opens in your browser at `http://127.0.0.1:4877`, showing a preview of your current session.
4. Pick a layout. Your statusline is now on, and every later change saves by itself.

## Update

Run the install script again: when the plugin is already installed, it updates it instead. By hand:

```bash
claude plugin marketplace update claude-code-super-statusline
claude plugin update super-statusline@claude-code-super-statusline
```

Then restart Claude Code (or run `/reload-plugins` in it). Installed from a local checkout? `git pull` there.

## When changes show up

Claude Code re-runs the statusline when something happens in the session (a new message, a mode
change) and, on top of that, on a timer. Applying the statusline sets that timer to every 5 seconds
(`refreshInterval` in `~/.claude/settings.json`), so a change saved in the page shows up within a
few seconds. Change it under *⋯ → Refresh*, or choose *Only on new messages* to turn the timer off.
A statusline applied by an earlier version has no timer until you pick one there.

## If you already have a statusline

The page asks before replacing it. To go back later, open the page and choose
*⋯ → Stop using this statusline*: your old one is restored.

## Install from a local checkout

```bash
git clone https://github.com/jinhuang712/claude-super-statusline
cd claude-super-statusline
bun install
claude plugin marketplace add "$PWD"
claude plugin install super-statusline@claude-code-super-statusline
```

The plugin then runs from your checkout, so a `git pull` updates it.

## Uninstall

1. In the page, choose *⋯ → Stop using this statusline* (this restores the statusline you had before).
2. Remove the plugin:
   ```bash
   claude plugin uninstall super-statusline@claude-code-super-statusline
   claude plugin marketplace remove claude-code-super-statusline
   ```

## Upgrading from claude-code-ssp

Versions up to 0.3.x were called `ssp` (`/ssp:config`).

1. Install the new plugin (the install script, or steps 1–2 above).
2. Run `/super-statusline:config` once. It moves your settings and widgets over.
3. Remove the old plugin:
   ```bash
   claude plugin uninstall ssp@claude-code-ssp
   claude plugin marketplace remove claude-code-ssp
   ```

A project's `.claude/claude-code-ssp.json` or `.claude/claude-code-ssp/widgets/` keeps working where it is.
