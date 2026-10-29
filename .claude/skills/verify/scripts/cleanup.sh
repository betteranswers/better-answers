#!/usr/bin/env bash
# Usage: cleanup.sh <port>
set -uo pipefail

port="${1:?usage: cleanup.sh <port>}"
state="${VERIFY_HOME:-/tmp/better-answers-verify}/$port"

if command -v agent-browser >/dev/null; then
  agent-browser --session "verify-$port" close >/dev/null 2>&1 || true
fi

if [[ -f "$state/server.pid" ]]; then
  pid="$(cat "$state/server.pid")"
  if ps -p "$pid" -o command= 2>/dev/null | grep -q 'tests/serve.ts'; then
    kill -TERM "$pid"
    for _ in $(seq 30); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
    if kill -0 "$pid" 2>/dev/null; then
      echo "cleanup: pid $pid outlived SIGTERM by 30 s; sending SIGKILL" >&2
      kill -KILL "$pid"
      for _ in $(seq 5); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 1
      done
    fi
  fi
  rm -f "$state/server.pid"
fi

held="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
if [[ -n "$held" ]]; then
  echo "cleanup: port $port is still held, by pid $held, which this skill did not start" >&2
  exit 1
fi
echo "port $port is free; evidence kept in $state/evidence"
