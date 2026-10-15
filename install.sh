#!/usr/bin/env bash
# Install or update super-statusline for Claude Code.
#
#   curl -fsSL https://raw.githubusercontent.com/jinhuang712/claude-super-statusline/main/install.sh | bash
#   bash install.sh [--yes]          from a checkout
#
# Safe to run again at any time: a first run adds the marketplace and installs the plugin; later
# runs update both. Before that it checks what the plugin needs — Claude Code 2.1.251 or later and
# Bun 1.1 or later — and offers to install Bun with its official installer when it is missing.
#
# Options:
#   -y, --yes    install Bun without asking (for scripts / CI)
#   -h, --help   this text
#
# SUPER_STATUSLINE_SOURCE overrides where the marketplace comes from (a GitHub owner/repo, a git
# URL or a local path), e.g. a fork, or a checkout: SUPER_STATUSLINE_SOURCE="$PWD" bash install.sh
set -euo pipefail

SOURCE="${SUPER_STATUSLINE_SOURCE:-jinhuang712/claude-super-statusline}"
MARKETPLACE="claude-code-super-statusline"
PLUGIN="super-statusline@${MARKETPLACE}"
LEGACY_PLUGIN="ssp@claude-code-ssp"
# `rate_limits`, `prompt_cache` and `effort` on the statusline's stdin arrived in 2.1.251.
MIN_CLAUDE="2.1.251"
# package.json engines.
MIN_BUN="1.1.0"

ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    -y | --yes) ASSUME_YES=1 ;;
    -h | --help)
      # The header comment above, without the shebang and the `#`s.
      sed -n '2,/^set -euo/p' "$0" 2>/dev/null | sed '$d; s/^# \{0,1\}//' || echo "usage: install.sh [--yes]"
      exit 0
      ;;
    *)
      echo "install.sh: unknown option $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

# ---- output: colour only on a terminal
if [ -t 1 ]; then
  BOLD=$'\033[1m' DIM=$'\033[2m' RED=$'\033[31m' GREEN=$'\033[32m' YELLOW=$'\033[33m' RESET=$'\033[0m'
else
  BOLD="" DIM="" RED="" GREEN="" YELLOW="" RESET=""
fi
step() { printf '%s==>%s %s\n' "$BOLD" "$RESET" "$*"; }
ok() { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
note() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$*"; }
fail() {
  printf '%serror:%s %s\n' "$RED" "$RESET" "$1" >&2
  shift
  for line in "$@"; do printf '       %s\n' "$line" >&2; done
  exit 1
}

# Can we ask the person running this? Piped through `curl | bash`, stdin is the script itself, so
# questions go to /dev/tty — but only when a terminal is actually attached (stderr is one), so a
# CI run never blocks on a prompt nobody will answer.
can_ask() { [ -t 2 ] && [ -r /dev/tty ]; }

# version_ge A B: is dotted version A >= B? (Plain numbers only; anything after them is ignored.)
version_ge() {
  local a b i x y
  IFS=. read -r -a a <<<"${1%%[!0-9.]*}"
  IFS=. read -r -a b <<<"${2%%[!0-9.]*}"
  for i in 0 1 2; do
    x="${a[i]:-0}" y="${b[i]:-0}"
    if ((10#$x > 10#$y)); then return 0; fi
    if ((10#$x < 10#$y)); then return 1; fi
  done
  return 0
}

case "$(uname -s 2>/dev/null || echo unknown)" in
  MINGW* | MSYS* | CYGWIN*)
    fail "this script is for macOS and Linux." \
      "On Windows, see https://github.com/jinhuang712/claude-super-statusline/blob/main/INSTALL.md"
    ;;
esac

# ---- 1. Claude Code
step "Checking Claude Code"
command -v claude >/dev/null 2>&1 ||
  fail "the claude command isn't on your PATH." "Install Claude Code first: https://docs.claude.com/en/docs/claude-code"
claude_version="$(claude --version 2>/dev/null | awk '{print $1; exit}')"
[ -n "$claude_version" ] || fail "couldn't read the Claude Code version (claude --version printed nothing)."
version_ge "$claude_version" "$MIN_CLAUDE" ||
  fail "Claude Code $claude_version is too old; super-statusline needs $MIN_CLAUDE or later." "Update it, then run this again."
ok "Claude Code $claude_version"

# ---- 2. Bun
step "Checking Bun"
# A Bun installed moments ago by its installer (below, or in another terminal) lives here and is
# only on PATH in new shells.
BUN_BIN_DIR="${BUN_INSTALL:-$HOME/.bun}/bin"
if ! command -v bun >/dev/null 2>&1 && [ -x "$BUN_BIN_DIR/bun" ]; then
  export PATH="$BUN_BIN_DIR:$PATH"
fi
bun_just_installed=0
if ! command -v bun >/dev/null 2>&1; then
  note "Bun isn't installed; the statusline runs on it."
  answer="n"
  if [ "$ASSUME_YES" = 1 ]; then
    answer="y"
  elif can_ask; then
    printf '  Install it now with the official installer (curl -fsSL https://bun.sh/install | bash)? [Y/n] ' >/dev/tty
    read -r answer </dev/tty || answer="n"
    answer="${answer:-y}"
  fi
  case "$answer" in
    y | Y | yes | YES) ;;
    *)
      fail "Bun is required." "Install it from https://bun.sh (or run this script with --yes), then run this again."
      ;;
  esac
  command -v curl >/dev/null 2>&1 || fail "installing Bun needs curl." "Install curl, or Bun itself from https://bun.sh"
  curl -fsSL https://bun.sh/install | bash
  export PATH="$BUN_BIN_DIR:$PATH"
  command -v bun >/dev/null 2>&1 || fail "Bun's installer finished, but bun still isn't found in $BUN_BIN_DIR."
  bun_just_installed=1
fi
bun_version="$(bun --version 2>/dev/null || true)"
[ -n "$bun_version" ] || fail "bun is on your PATH but doesn't run ($(command -v bun))."
version_ge "$bun_version" "$MIN_BUN" ||
  fail "Bun $bun_version is too old; super-statusline needs $MIN_BUN or later." "Update it with: bun upgrade"
ok "Bun $bun_version ($(command -v bun))"

# ---- 3. What is installed already
# `claude plugin … --json` is the stable way to ask; Bun (present by now) reads the JSON.
plugins_json="$(claude plugin list --json 2>/dev/null || echo '[]')"
markets_json="$(claude plugin marketplace list --json 2>/dev/null || echo '[]')"
has_plugin() {
  ID="$1" bun -e 'const l = JSON.parse(await Bun.stdin.text() || "[]"); process.exit(l.some((p) => p.id === process.env.ID) ? 0 : 1)' <<<"$plugins_json"
}
# "<source>\t<where>" of our marketplace, or nothing when it isn't configured.
our_market="$(NAME="$MARKETPLACE" bun -e 'const m = JSON.parse(await Bun.stdin.text() || "[]").find((x) => x.name === process.env.NAME); if (m) console.log(`${m.source}\t${m.path ?? m.repo ?? m.url ?? ""}`)' <<<"$markets_json")"

# ---- 4. Install or update
if [ -z "$our_market" ]; then
  step "Adding the marketplace ($SOURCE)"
  claude plugin marketplace add "$SOURCE"
else
  market_source="${our_market%%$'\t'*}"
  market_where="${our_market#*$'\t'}"
  step "Updating the marketplace"
  claude plugin marketplace update "$MARKETPLACE"
  if [ "$market_source" = "directory" ]; then
    # A local checkout is read in place: new code arrives with git, not with this script.
    note "It's a local checkout ($market_where): pull there to get new code (git -C \"$market_where\" pull)."
  fi
fi

if has_plugin "$PLUGIN"; then
  step "Updating $PLUGIN"
  claude plugin update "$PLUGIN"
  action="updated"
else
  step "Installing $PLUGIN"
  claude plugin install "$PLUGIN"
  action="installed"
fi

# ---- 5. What next
echo
printf '%sDone — super-statusline is %s.%s\n' "$BOLD" "$action" "$RESET"
if [ "$action" = "installed" ]; then
  echo "  In Claude Code, run /super-statusline:config and pick a layout."
  echo "  (Already in a session? Run /reload-plugins first.)"
else
  echo "  Restart Claude Code, or run /reload-plugins in it, to load the new version."
fi
if [ "$bun_just_installed" = 1 ]; then
  echo "  Bun was just installed: open a new terminal before starting Claude Code, so it finds bun."
fi
if has_plugin "$LEGACY_PLUGIN"; then
  echo
  note "The old ssp plugin is still installed. After running /super-statusline:config once (it moves your settings over), remove it:"
  printf '      %sclaude plugin uninstall %s && claude plugin marketplace remove claude-code-ssp%s\n' "$DIM" "$LEGACY_PLUGIN" "$RESET"
fi
