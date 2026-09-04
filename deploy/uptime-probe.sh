#!/usr/bin/env bash
#
# The Free-plan uptime probe (coolify.md § Ingress). Run by host cron on VPC 2
# every five minutes while the zone is not yet on Cloudflare Pro; Pro's Health
# Checks replace it. Probes the two public paths through the edge — DNS, tunnel
# and origin all on the probed path — then pings the healthchecks.io 'uptime'
# check with the outcome, so a silent probe (VPC 2 down included) trips the
# dead-man alarm on the second channel. The ping body is an outcome word and
# counts, never a path or an error string ([OPS1]).
#
# Env (root-only /etc/better-answers/uptime.env, sourced with set -a by cron):
#   APEX                          the apex domain, e.g. example.com
#   HEALTHCHECKS_PING_URL_UPTIME  the 'uptime' check's ping URL

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
