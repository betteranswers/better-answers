#!/usr/bin/env bash
# Runs on VPC 2, so if VPC 2 itself goes down, the missing ping also trips the dead-man alarm.
set -euo pipefail

: "${APEX:?is not set. Source /etc/better-answers/uptime.env first}"
: "${HEALTHCHECKS_PING_URL_UPTIME:?is not set. Source /etc/better-answers/uptime.env first}"

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
