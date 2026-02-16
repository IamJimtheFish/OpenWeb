#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TMUX_SESSION="${WEBX_FRESH_TMUX_SESSION:-webx-fresh}"
API_BASE="${WEBX_API_BASE:-http://127.0.0.1:3000}"

if ! command -v tmux >/dev/null 2>&1; then
  echo "[webx-up] tmux is required" >&2
  exit 1
fi

if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
  echo "[webx-up] session already running: $TMUX_SESSION"
else
  tmux new-session -d -s "$TMUX_SESSION" -c "$REPO_ROOT" "corepack pnpm dev"
  echo "[webx-up] started session: $TMUX_SESSION"
fi

echo "[webx-up] waiting for API: $API_BASE/health"
for _ in {1..40}; do
  if curl -fsS "$API_BASE/health" >/dev/null 2>&1; then
    echo "[webx-up] API ready"
    exit 0
  fi
  sleep 0.5
done

echo "[webx-up] API did not become ready" >&2
tmux capture-pane -pt "$TMUX_SESSION":0 | tail -n 80 >&2 || true
exit 1
