#!/usr/bin/env bash
# regenerate.sh — rebuild the Sheaf guide end to end:
#   1. (re)generate the seed PDF        2. production-build the single-file app
#   3. serve the build on a pinned port 4. capture every feature shot (real browser)
#   5. assemble the single-file guide/index.html
# Idempotent: reuses a running server on the port, tears down one it started itself.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-8791}"
BASE="http://127.0.0.1:${PORT}"
cd "$ROOT"

echo "── 1/5  seed"
node guide/seed/make-seed.mjs

echo "── 2/5  build single-file app"
node build/inline.mjs

echo "── 3/5  server on ${BASE}"
STARTED_SERVER=0
if curl -fsS -m 2 "${BASE}/index.html" >/dev/null 2>&1; then
  echo "    reusing server already on :${PORT}"
else
  python3 -m http.server "${PORT}" --bind 127.0.0.1 >/tmp/sheaf-guide-server.log 2>&1 &
  SERVER_PID=$!
  STARTED_SERVER=1
  until curl -fsS -m 2 "${BASE}/index.html" >/dev/null 2>&1; do sleep 0.3; done
  echo "    started server pid ${SERVER_PID}"
fi
cleanup() { if [ "${STARTED_SERVER}" = "1" ]; then kill "${SERVER_PID}" 2>/dev/null || true; fi; }
trap cleanup EXIT

echo "── 4/5  capture"
BASE="${BASE}" node guide/capture.mjs

echo "── 5/5  build index.html"
node guide/build_index.mjs

echo "✓ guide ready → guide/index.html"
