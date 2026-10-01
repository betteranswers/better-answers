#!/usr/bin/env bash
# A job pings the dead-man service only after its upload is verified, so an up check with a
# recent ping is a backup that exists.
set -euo pipefail

refuse() {
  echo "::error::$1" >&2
  exit 1
}

[ -n "${HEALTHCHECKS_READ_KEY:-}" ] ||
  refuse "HEALTHCHECKS_READ_KEY is not set in the production environment, so the nightly release cannot read whether the box's backup is fresh (RUNBOOK.md page 6)"
api="${HEALTHCHECKS_API_URL:-https://healthchecks.io}"
now="$(date -u +%s)"

iso() { jq -nr --argjson at "$1" '$at | todate'; }

# No upper bound: a job may ping while this reads, after `now` was taken.
fresh() {
  local slug="$1" since="$2" answer code status last pinged
  answer="$(mktemp)"
  code="$(curl -sS --max-redirs 0 --max-time 20 -o "${answer}" -w '%{http_code}' \
    -H "X-Api-Key: ${HEALTHCHECKS_READ_KEY}" "${api}/api/v3/checks/?slug=${slug}")" || code="no answer"
  [ "${code}" = 200 ] ||
    refuse "the dead-man service answered ${code} for the ${slug} check, so the backup's freshness is unknown and nothing is released"
  [ "$(jq '.checks | length' "${answer}")" = 1 ] ||
    refuse "the dead-man service has no single ${slug} check, so the backup's freshness is unknown and nothing is released"
  status="$(jq -r '.checks[0].status' "${answer}")"
  last="$(jq -r '.checks[0].last_ping // "never"' "${answer}")"
  pinged="$(jq '.checks[0].last_ping // "1970-01-01T00:00:00Z" | sub("\\.[0-9]+"; "") | sub("\\+00:00$"; "Z") | fromdateiso8601' "${answer}")"
  if [ "${status}" != up ] || [ "${pinged}" -lt "${since}" ]; then
    refuse "the ${slug} backup is not fresh: its check is ${status}, last pinged ${last}, where it needs to be up and pinged since $(iso "${since}"), so nothing is released"
  fi
  echo "${last}"
}

# Dumps run hourly at :05, store copies at 02:00 UTC. A release starts hours late, so it needs
# copies since the last 02:00.
dump="$(fresh pg-hourly $((now - 65 * 60)))"
copies="$(fresh nightly $((now - (now - 7200) % 86400)))"
echo "the box's own backup: the database dump verified at ${dump}, the object and git store copies at ${copies}"
