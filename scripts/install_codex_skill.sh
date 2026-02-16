#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_SKILL_DIR="$REPO_ROOT/SKILLS/webx"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
TARGET_SKILL_DIR="$CODEX_HOME/skills/webx-fresh"
CONFIG_PATH="$CODEX_HOME/config.toml"
CONFIGURE_MCP=0

if [[ "${1:-}" == "--configure-mcp" ]]; then
  CONFIGURE_MCP=1
fi

if [[ ! -f "$SOURCE_SKILL_DIR/SKILL.md" ]]; then
  echo "[install] missing skill source: $SOURCE_SKILL_DIR/SKILL.md" >&2
  exit 1
fi

mkdir -p "$CODEX_HOME/skills"

if [[ -L "$TARGET_SKILL_DIR" ]]; then
  unlink "$TARGET_SKILL_DIR"
elif [[ -e "$TARGET_SKILL_DIR" ]]; then
  echo "[install] target exists and is not a symlink: $TARGET_SKILL_DIR" >&2
  echo "[install] move/remove it manually, then rerun" >&2
  exit 1
fi

ln -s "$SOURCE_SKILL_DIR" "$TARGET_SKILL_DIR"
echo "[install] linked skill: $TARGET_SKILL_DIR -> $SOURCE_SKILL_DIR"

if [[ $CONFIGURE_MCP -eq 1 ]]; then
  mkdir -p "$CODEX_HOME"
  touch "$CONFIG_PATH"

  if rg -n "^\[mcp_servers\.webx_fresh\]" "$CONFIG_PATH" >/dev/null 2>&1; then
    echo "[install] MCP server config already exists: mcp_servers.webx_fresh"
  else
    cat >> "$CONFIG_PATH" <<CFG

[mcp_servers.webx_fresh]
command = "corepack"
args = ["pnpm", "--dir", "$REPO_ROOT", "mcp"]
CFG
    echo "[install] appended MCP config to $CONFIG_PATH"
  fi
fi

cat <<MSG
[install] done
Next steps:
1) Start services: $TARGET_SKILL_DIR/scripts/webx-up.sh
2) Verify:         $TARGET_SKILL_DIR/scripts/webx-verify.sh
3) Stop services:  $TARGET_SKILL_DIR/scripts/webx-down.sh
MSG
