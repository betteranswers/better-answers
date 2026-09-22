#!/usr/bin/env bash

set -euo pipefail

: "${APEX:?APEX not set — source /etc/better-answers/uptime.env}"
: "${HEALTHCHECKS_PING_URL_UPTIME:?HEALTHCHECKS_PING_URL_UPTIME not set}"

failing=0
for probe_path in /health /.well-known/oauth-protected-resource/mcp; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
    "https://app.${APEX}${probe_path}" || true)
  [[ "$code" == "200" ]] || failing=$((failing + 1))
done

if (( failing == 0 )); then suffix=""; body="ok 2/2"
else suffix="/fail"; body="fail ${failing}/2"; fi
curl -fsS --max-time 10 --retry 3 --data-raw "$body" \
  "${HEALTHCHECKS_PING_URL_UPTIME}${suffix}" >/dev/null
