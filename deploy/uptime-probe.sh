#!/usr/bin/env bash
#
# The Free-plan uptime probe (coolify.md § Ingress). Run by host cron on VPC 2
# every five minutes while the zone is not yet on Cloudflare Pro; Pro's Health
# Checks replace it. Probes the two public paths through the edge — DNS, tunnel
# and origin all on the probed path — then pings the healthchecks.io 'uptime'
# check with the outcome, so a silent probe (VPC 2 down included) trips the
# dead-man alarm on the second channel.
#
# Env (root-only /etc/better-answers/uptime.env):
#   APEX                          the apex domain, e.g. example.com
#   HEALTHCHECKS_PING_URL_UPTIME  the 'uptime' check's ping URL

set -euo pipefail

: "${APEX:?APEX not set — source /etc/better-answers/uptime.env}"
: "${HEALTHCHECKS_PING_URL_UPTIME:?HEALTHCHECKS_PING_URL_UPTIME not set}"

failures=""
for probe_path in /health /.well-known/oauth-protected-resource/mcp; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 \
    "https://app.${APEX}${probe_path}" 2>/dev/null || printf '000')
  if [[ "$code" != "200" ]]; then
    failures="${failures}app.${APEX}${probe_path} answered ${code}; "
  fi
done

if [[ -z "$failures" ]]; then
  curl -fsS --max-time 10 --retry 3 \
    --data-raw "ok both paths 200" "$HEALTHCHECKS_PING_URL_UPTIME" >/dev/null
else
  curl -fsS --max-time 10 --retry 3 \
    --data-raw "$failures" "${HEALTHCHECKS_PING_URL_UPTIME}/fail" >/dev/null
fi
