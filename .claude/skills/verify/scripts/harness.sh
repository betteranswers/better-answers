#!/usr/bin/env bash
# Usage: harness.sh <port> <GET|POST|DELETE> <path under /__harness> [json body]
set -euo pipefail

port="${1:?usage: harness.sh <port> <method> <path> [json body]}"
method="${2:?usage: harness.sh <port> <method> <path> [json body]}"
path="${3:?usage: harness.sh <port> <method> <path> [json body]}"
body="${4:-}"

answer="$(mktemp)"
trap 'rm -f "$answer"' EXIT
args=(-s -o "$answer" -w '%{http_code}' -X "$method" "http://localhost:$port/__harness$path")
[[ -z "$body" ]] || args+=(-H 'content-type: application/json' --data "$body")
status="$(curl "${args[@]}")"

if [[ "$status" != 2* ]]; then
  echo "/__harness$path answered $status: $(cat "$answer")" >&2
  exit 1
fi
cat "$answer"
echo
