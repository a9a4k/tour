#!/usr/bin/env bash
# Smoke-test a compiled `tour` binary by exercising both lazy-import
# surfaces. Catches "ships fine in dev, dies in --compile" bugs by booting
# the binary and asserting it doesn't blow up at the
# `await import("../tui/app.js" | "../web/server.js")` call sites.
#
# Usage: scripts/smoke-binary.sh <path-to-binary>

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: scripts/smoke-binary.sh <path-to-binary>" >&2
  exit 2
fi

BIN="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
[ -x "$BIN" ] || { echo "ERROR: $BIN is not executable" >&2; exit 1; }

PORT="${SMOKE_PORT:-17777}"
SERVE_PID=""
TUI_PID=""

tmp=$(mktemp -d)
cleanup() {
  for pid in "$SERVE_PID" "$TUI_PID"; do
    if [ -n "$pid" ]; then
      kill -KILL "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  rm -rf "$tmp"
}
trap cleanup EXIT
cd "$tmp"

echo "==> version smoke"
"$BIN" --version

# --- serve / web/server.js smoke ---
# If the lazy import of ../web/server.js is unbundled, serve never binds
# and the curl loop times out. If serve binds but Bun.build can't resolve
# the client entry, the bundle endpoints return error stubs.
echo "==> serve smoke (port $PORT)"
"$BIN" serve --port "$PORT" > serve.log 2>&1 &
SERVE_PID=$!

fetch() {
  curl --retry-connrefused --retry 60 --retry-delay 1 \
    -fsS "http://127.0.0.1:$PORT$1" -o "$2"
}

assert_bundle() {
  local path="$1" out="$2"
  if ! fetch "$path" "$out"; then
    echo "ERROR: $path did not return 2xx" >&2
    echo "--- serve.log ---" >&2
    cat serve.log >&2
    exit 1
  fi
  if grep -E "Cannot find module|client bundle (failed|threw)|entry-point not emitted" "$out" >/dev/null; then
    echo "ERROR: $path returned an error stub:" >&2
    cat "$out" >&2
    exit 1
  fi
  local size
  size=$(wc -c < "$out")
  if [ "$size" -lt 1024 ]; then
    echo "ERROR: $path suspiciously small ($size bytes)" >&2
    cat "$out" >&2
    exit 1
  fi
  echo "OK: $path served $size bytes"
}

assert_bundle /client.js client.js.out
assert_bundle /pierre-worker.js pierre-worker.js.out

kill "$SERVE_PID" 2>/dev/null || true
wait "$SERVE_PID" 2>/dev/null || true
SERVE_PID=""

# --- tui / tui/app.js smoke ---
# `tour tui` reaches the lazy import after loading a tour bundle. With no
# tours present it throws before the import — so set up an ephemeral repo
# + tour to reach the call site. Don't care about TUI rendering: opentui
# doesn't exit without a TTY, so a hard watchdog kills it after a few
# seconds. Only check that the dynamic import resolved (no
# "Cannot find module" / "ResolveMessage" in stderr).
echo "==> tui smoke (lazy-import resolution)"
git init -q smoke-repo
cd smoke-repo
git config user.email tour-ci@example.com
git config user.name tour-ci
echo hello > a.txt
git add a.txt
git commit -q -m "init"
# `tour create --head HEAD` defaults the base to HEAD^ (src/cli/create.ts).
# Add a second commit so the default resolves; otherwise `git rev-parse
# HEAD^` errors and the smoke fails before reaching the lazy import.
echo world >> a.txt
git add a.txt
git commit -q -m "second"
"$BIN" create --head HEAD --title smoke > /dev/null

"$BIN" tui </dev/null > /dev/null 2>tui.err &
TUI_PID=$!
sleep 4
kill -KILL "$TUI_PID" 2>/dev/null || true
wait "$TUI_PID" 2>/dev/null || true

if grep -E "Cannot find module|ResolveMessage" tui.err >/dev/null; then
  echo "ERROR: tui lazy import failed:" >&2
  cat tui.err >&2
  exit 1
fi
echo "OK: tui lazy import resolved"

echo ""
echo "smoke passed."
