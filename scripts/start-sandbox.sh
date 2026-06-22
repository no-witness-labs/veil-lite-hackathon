#!/usr/bin/env bash
# Start the Canton sandbox on OpenJDK 17 and bootstrap it for the Veil demo.
#
# Canton 3.5 must NOT run on Oracle JDK 20 — its bundled BouncyCastle provider
# fails JCE authentication there and every transaction errors. We pin OpenJDK 17.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

JAVA_HOME="${VEIL_JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
[ -x "$JAVA_HOME/bin/java" ] || {
  echo "OpenJDK 17 not found at $JAVA_HOME" >&2
  echo "Install with: brew install openjdk@17   (or set VEIL_JAVA_HOME)" >&2
  exit 1
}
export JAVA_HOME
export PATH="$JAVA_HOME/bin:$HOME/.dpm/bin:$PATH"

echo "→ Java: $(java -version 2>&1 | head -1)"
[ -f .daml/dist/veil-0.1.0.dar ] || { echo "→ Building DAR"; dpm build; }

echo "→ Starting Canton sandbox (logs: log/canton.log)"
rm -f log/canton.log
dpm sandbox > /tmp/veil-sandbox.log 2>&1 &
SANDBOX_PID=$!
echo "  sandbox pid $SANDBOX_PID"

echo "→ Waiting for JSON Ledger API"
until grep -q "HTTP JSON API Server started" log/canton.log 2>/dev/null; do
  kill -0 "$SANDBOX_PID" 2>/dev/null || { echo "Sandbox process died — see log/canton.log" >&2; exit 1; }
  sleep 1
done
# The "started" log line precedes full readiness — wait for /readyz to avoid a
# race where the first package upload returns HTTP 400.
until [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:6864/readyz)" = "200" ]; do
  sleep 1
done

"$ROOT/scripts/bootstrap.sh"

echo ""
echo "✓ Sandbox ready on http://127.0.0.1:6864 (gRPC 6865). Sandbox pid: $SANDBOX_PID"
echo "  Next: npm --prefix frontend install && npm --prefix frontend run dev"
echo "  Stop the sandbox with: kill $SANDBOX_PID"
