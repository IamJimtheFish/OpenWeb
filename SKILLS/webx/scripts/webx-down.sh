#!/usr/bin/env bash
set -euo pipefail

TMUX_SESSION="${WEBX_FRESH_TMUX_SESSION:-webx-fresh}"

if command -v tmux >/dev/null 2>&1 && tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
  tmux kill-session -t "$TMUX_SESSION"
  echo "[webx-down] stopped tmux session: $TMUX_SESSION"
else
  echo "[webx-down] no running tmux session: $TMUX_SESSION"
fi

# Fallback cleanup in case child processes outlive tmux.
pkill -u "$(id -u)" -f "tsx scripts/dev.ts" >/dev/null 2>&1 || true
pkill -u "$(id -u)" -f "tsx packages/api/src/server.ts" >/dev/null 2>&1 || true
pkill -u "$(id -u)" -f "tsx packages/crawler/src/worker.ts" >/dev/null 2>&1 || true
pkill -u "$(id -u)" -f "tsx packages/mcp/src/server.ts" >/dev/null 2>&1 || true
echo "[webx-down] cleanup complete"
