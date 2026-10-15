#!/usr/bin/env bash
# Runs the mod's tests (hooks/*.test.ts) with `claude plugin test`.
#
# That command runs every *.test.ts under the folder it is given, and this repository's own tests
# (tests/, run by `bun test`) import "bun:test", which the mod's sandbox cannot load. So the mod is
# copied, without tests/, web/ and the rest, into a temporary folder and tested there. bunfig.toml
# keeps `bun test` out of hooks/ for the opposite reason.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/super-statusline-mod.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

# Only what the mod imports: its manifest, hooks, state contract and the widget code it reuses.
cp -R "$ROOT/.claude-plugin" "$ROOT/hooks" "$ROOT/types" "$ROOT/src" "$TMP/"
rm -rf "$TMP/.claude-plugin/types"

claude plugin test "$TMP"
