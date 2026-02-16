#!/usr/bin/env bash
set -euo pipefail

API_BASE="${WEBX_API_BASE:-http://127.0.0.1:3000}"

echo "[webx-verify] health"
curl -fsS "$API_BASE/health" | head -c 300 >/dev/null

echo "[webx-verify] open local health page"
curl -fsS -X POST "$API_BASE/tools/webx.open" \
  -H 'content-type: application/json' \
  --data-binary '{"url":"http://127.0.0.1:3000/health","mode":"compact","use":"static"}' \
  | head -c 300 >/dev/null

echo "[webx-verify] store query"
curl -fsS -X POST "$API_BASE/tools/webx.store.query" \
  -H 'content-type: application/json' \
  --data-binary '{"text":"health","limit":1}' \
  | head -c 300 >/dev/null

echo "[webx-verify] ok"
