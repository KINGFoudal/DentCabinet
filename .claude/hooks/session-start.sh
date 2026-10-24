#!/bin/bash
# Installs graphify so the PreToolUse hooks in .claude/settings.json work.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

export PATH="$HOME/.local/bin:$PATH"

if ! command -v graphify >/dev/null 2>&1; then
  if command -v uv >/dev/null 2>&1; then
    uv tool install graphifyy
  elif command -v pipx >/dev/null 2>&1; then
    pipx install graphifyy
  else
    echo "graphify: neither uv nor pipx found" >&2
    exit 1
  fi
fi

# Copies the graphify skill into ~/.claude/skills (idempotent).
graphify install >/dev/null
