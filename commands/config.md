---
description: Open the super-statusline web configurator (starts the local server if needed)
allowed-tools: Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/super-statusline.sh:*)
---

Run exactly this command and report its output to the user verbatim (one or two lines, no extra commentary):

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/super-statusline.sh" config
```

It starts `claude-super-statusline serve` on 127.0.0.1:4877 if it is not already running and opens the browser on
this session's preview (it passes `$CLAUDE_CODE_SESSION_ID`).
If it fails, show the log excerpt it prints and suggest `bun install` inside the plugin root.
