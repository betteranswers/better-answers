#!/usr/bin/env bash
# Usage: launch.sh <port> [--no-build]
set -euo pipefail

port="${1:?usage: launch.sh <port> [--no-build]}"
build="${2:-}"
[[ "$port" =~ ^[0-9]+$ ]] || { echo "launch: the port must be a number, not $port" >&2; exit 2; }
[[ -z "$build" || "$build" == "--no-build" ]] || { echo "launch: the second argument may only be --no-build, not $build" >&2; exit 2; }

root="$(cd "$(dirname "$0")/../../../.." && pwd)"
home="${VERIFY_HOME:-/tmp/better-answers-verify}"
state="$home/$port"
origin="http://localhost:$port"

if [[ -f "$state/server.pid" ]] && kill -0 "$(cat "$state/server.pid")" 2>/dev/null; then
  echo "launch: $origin is already this skill's instance, pid $(cat "$state/server.pid"). Run doctor.sh $port, or cleanup.sh $port first." >&2
  exit 1
fi
for tool in lsof curl node pnpm docker; do
  command -v "$tool" >/dev/null || { echo "launch: $tool is not on PATH" >&2; exit 1; }
done
[[ -d "$root/node_modules" ]] \
  || { echo "launch: $root has no node_modules; run pnpm install --frozen-lockfile there first" >&2; exit 1; }
held="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
if [[ -n "$held" ]]; then
  echo "launch: port $port is held by pid $held, which this skill did not start. Pick another port." >&2
  exit 1
fi

mkdir -p "$state/evidence"

if [[ "$build" != "--no-build" ]]; then
  for other in "$home"/*/server.pid; do
    if [[ -f "$other" ]] && kill -0 "$(cat "$other")" 2>/dev/null \
      && [[ "$(cat "$(dirname "$other")/root" 2>/dev/null)" == "$root" ]]; then
      echo "launch: another instance ($other) serves this checkout's apps/web/dist, and a build would rewrite it under that instance. Launch with --no-build." >&2
      exit 1
    fi
  done
  (cd "$root" && pnpm --filter @better-answers/web run build) >"$state/build.log" 2>&1 \
    || { echo "launch: the SPA build failed; read $state/build.log" >&2; exit 1; }
fi
[[ -f "$root/apps/web/dist/index.html" ]] \
  || { echo "launch: apps/web has no build to serve; run launch.sh $port without --no-build" >&2; exit 1; }

cd "$root/apps/api"
nohup node tests/serve.ts "$port" >"$state/server.log" 2>&1 &
echo $! >"$state/server.pid"
echo "$root" >"$state/root"
pid="$(cat "$state/server.pid")"

deadline=$((SECONDS + 240))
until [[ "$(curl -s --max-time 5 -o /dev/null -w '%{http_code}' "$origin/health" || true)" == "200" ]]; do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "launch: the server exited before /health answered 200. Its log ends:" >&2
    tail -n 20 "$state/server.log" >&2
    rm -f "$state/server.pid"
    exit 1
  fi
  if ((SECONDS > deadline)); then
    echo "launch: /health did not answer 200 within 240 s; run cleanup.sh $port and read $state/server.log" >&2
    exit 1
  fi
  sleep 2
done

echo "origin   $origin"
echo "pid      $pid"
echo "log      $state/server.log"
echo "evidence $state/evidence"
