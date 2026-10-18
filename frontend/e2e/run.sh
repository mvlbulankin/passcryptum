#!/usr/bin/env bash
# End-to-end runner.
#
# Two halves, deliberately:
#   1. the stack (Go binary, SQLite, onboarded profiles, TLS via Caddy) runs on
#      the HOST — that is where the toolchain and the binary are;
#   2. the browser runs in the official Playwright container, because the host
#      lacks the system libraries Chromium needs (libnss3, libnspr4, ...).
# The container reaches the stack through Caddy over TLS: the host name is not
# a secure context over plain HTTP, and without a secure context crypto.subtle
# is undefined, which would break every login.
#
# NOTE on WSL2 + Docker Desktop: `--network host` joins the Docker VM's
# network, NOT the WSL distro — 127.0.0.1 there is the VM, not this machine.
# Everything therefore runs on the default bridge and reaches the host by its
# WSL address.
#
#   ./e2e/run.sh                      # whole suite
#   ./e2e/run.sh e2e/sync.spec.ts     # one file
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CDIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE="mcr.microsoft.com/playwright:v1.64.1-noble"
PORT=8901
TLS_PORT=8443
# Bridge networking: the container must reach the WSL host by address.
HOST_ADDR="${E2E_HOST_ADDR:-$(ip -4 addr show eth0 2>/dev/null | grep -oP 'inet \K[\d.]+' | head -1)}"
if [[ -z "$HOST_ADDR" ]]; then
  echo "e2e: cannot determine the host address (set E2E_HOST_ADDR)" >&2
  exit 1
fi
echo "== host address: $HOST_ADDR ==" 
CADDY_NAME="passcryptum-e2e-caddy"
NET="passcryptum-e2e"
CERT_DIR="$(mktemp -d)"
STACK_LOG="$(mktemp)"

cleanup() {
  [[ -n "${STACK_PID:-}" ]] && kill "$STACK_PID" 2>/dev/null || true
  [[ -n "${WORKDIR:-}" ]] && rm -rf "$WORKDIR" || true
  docker rm -f "$CADDY_NAME" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -rf "$CERT_DIR" "$STACK_LOG"
}
trap cleanup EXIT

echo "== stack: build + onboard + serve (host) =="
(cd "$CDIR" && node --experimental-strip-types start-stack.ts 2>&1 | tee "$STACK_LOG" >&2) &
STACK_RUNNER=$!

# The stack script prints its pid and workdir when the server is up.
for _ in $(seq 1 240); do
  STACK_PID="$(sed -n 's/^E2E_SERVER_PID=//p' "$STACK_LOG" | head -1)"
  WORKDIR="$(sed -n 's/^E2E_WORKDIR=//p' "$STACK_LOG" | head -1)"
  [[ -n "$STACK_PID" ]] && break
  sleep 0.5
done

if [[ -z "${STACK_PID:-}" ]]; then
  echo "e2e: stack failed to start" >&2
  exit 1
fi

echo "== TLS front (Caddy, self-signed) =="
openssl req -x509 -newkey rsa:2048 -nodes -days 2 \
  -subj "/CN=$HOST_ADDR" \
  -addext "subjectAltName=DNS:localhost,DNS:$CADDY_NAME,IP:$HOST_ADDR,IP:127.0.0.1" \
  -keyout "$CERT_DIR/key.pem" -out "$CERT_DIR/cert.pem" 2>/dev/null

cat > "$CERT_DIR/Caddyfile" <<CADDY
:$TLS_PORT {
	tls /certs/cert.pem /certs/key.pem
	reverse_proxy $HOST_ADDR:$PORT
}
CADDY

docker rm -f "$CADDY_NAME" >/dev/null 2>&1 || true
docker network rm "$NET" >/dev/null 2>&1 || true
docker network create "$NET" >/dev/null
# Caddy is the only TLS endpoint the browser talks to; on a user-defined
# network its name resolves as a host.
docker run -d --name "$CADDY_NAME" --network "$NET" \
  -v "$CERT_DIR/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -v "$CERT_DIR:/certs:ro" \
  caddy:2 >/dev/null

for _ in $(seq 1 60); do
  docker run --rm --network "$NET" curlimages/curl:latest \
    -sk --max-time 2 -o /dev/null "https://$CADDY_NAME:$TLS_PORT/manifest.json" && break
  sleep 0.5
done

echo "== browser (Playwright container) =="
docker run --rm \
  --network "$NET" \
  -v "$ROOT:/work" \
  -e CI="${CI:-}" \
  -e HOME=/tmp \
  -e E2E_BASE_URL="https://$CADDY_NAME:$TLS_PORT" \
  -w /work/frontend \
  "$IMAGE" \
  sh -c 'cd /work/frontend && ./node_modules/.bin/playwright test "$@"' playwright "$@"
