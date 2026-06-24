#!/usr/bin/env bash
# Stop the Canton sandbox started by scripts/start-sandbox.sh.
#
# start-sandbox.sh backgrounds `dpm sandbox`, which spawns the Canton JVM as a
# child. Killing the launcher does not always reap the JVM, so we target both.
set -euo pipefail

found=0
for pattern in "dpm sandbox" "canton-open-source-.*\.jar sandbox"; do
  pids="$(pgrep -f "$pattern" || true)"
  [ -n "$pids" ] || continue
  found=1
  echo "→ Stopping: $pattern (pids: $pids)"
  kill $pids 2>/dev/null || true
done

if [ "$found" = "0" ]; then
  echo "✓ No Canton sandbox process running"
  exit 0
fi

echo "→ Waiting for processes to exit"
for _ in $(seq 1 10); do
  pgrep -f "dpm sandbox" >/dev/null 2>&1 || pgrep -f "canton-open-source-.*\.jar sandbox" >/dev/null 2>&1 || { echo "✓ Sandbox stopped"; exit 0; }
  sleep 1
done

echo "→ Still running after 10s, forcing"
pkill -9 -f "dpm sandbox" 2>/dev/null || true
pkill -9 -f "canton-open-source-.*\.jar sandbox" 2>/dev/null || true
echo "✓ Sandbox stopped (forced)"
