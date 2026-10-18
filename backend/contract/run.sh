#!/usr/bin/env bash
# Runs the wire-protocol contract suite against a throwaway LOCAL backend
# (build -> genkey -> onboard -> serve -> go test -> teardown).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
GO="${GO:-go}"
export GOPATH="${GOPATH:-$HOME/.local/share/go}"

WORK="$(mktemp -d)"
trap 'kill ${SRV:-} 2>/dev/null || true; rm -rf "$WORK"' EXIT

echo "== building =="
cd "$ROOT/backend"
"$GO" build -o "$WORK/passcryptum" .

KEYS="$("$WORK/passcryptum" genkey 2>/dev/null)"
PRIV="$(echo "$KEYS" | head -1 | awk '{print $2}')"
PUB="$(echo "$KEYS"  | sed -n 2p | awk '{print $2}')"

export PC_DB="$WORK/db.sqlite3"
"$WORK/passcryptum" add-public-key "$PUB" >/dev/null
"$WORK/passcryptum" serve 127.0.0.1:8777 >"$WORK/server.log" 2>&1 &
SRV=$!
for _ in $(seq 1 40); do
  if curl -s -o /dev/null "http://127.0.0.1:8777/api/profiles/"; then break; fi
  sleep 0.1
done

echo "== contract tests vs local Go backend =="
PC_BASE_URL="http://127.0.0.1:8777" PC_PRIVATE_SEED="$PRIV" PC_PUBLIC_KEY="$PUB" \
  "$GO" test ./contract -count=1 "$@"
