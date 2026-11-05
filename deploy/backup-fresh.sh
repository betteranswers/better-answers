#!/usr/bin/env bash
# A backup job pings the dead-man service only after it verifies its upload, so a check that
# is up with a recent ping proves the backup exists.
set -euo pipefail

refuse() {
  echo "::error::$1" >&2
  exit 1
}

[ -n "${HEALTHCHECKS_READ_KEY:-}" ] ||
  refuse "HEALTHCHECKS_READ_KEY is not set in the production environment, so the nightly release cannot check that the backup is fresh. Add the dead-man service's read-only key as that secret (RUNBOOK.md page 6)."
api="${HEALTHCHECKS_API_URL:-https://healthchecks.io}"
now="$(date -u +%s)"

iso() { jq -nr --argjson at "$1" '$at | todate'; }

# No upper bound: a job may ping after `now` was read and before this check runs.
fresh() {
  local slug="$1" since="$2" answer code status last pinged
  answer="$(mktemp)"
  code="$(curl -sS --max-redirs 0 --max-time 20 -o "${answer}" -w '%{http_code}' \
    -H "X-Api-Key: ${HEALTHCHECKS_READ_KEY}" "${api}/api/v3/checks/?slug=${slug}")" || code="no answer"
  [ "${code}" = 200 ] ||
    refuse "The dead-man service answered ${code} for the ${slug} check, so the backup could not be checked and nothing was released."
  [ "$(jq '.checks | length' "${answer}")" = 1 ] ||
    refuse "The dead-man service does not have exactly one ${slug} check, so the backup could not be checked and nothing was released. Make sure the project has one check with that slug."
  status="$(jq -r '.checks[0].status' "${answer}")"
  last="$(jq -r '.checks[0].last_ping // "never"' "${answer}")"
  pinged="$(jq '.checks[0].last_ping // "1970-01-01T00:00:00Z" | sub("\\.[0-9]+"; "") | sub("\\+00:00$"; "Z") | fromdateiso8601' "${answer}")"
  if [ "${status}" != up ] || [ "${pinged}" -lt "${since}" ]; then
    refuse "The ${slug} backup is not fresh, so nothing was released. Its check is ${status} and was last pinged at ${last}. It must be up and pinged at or after $(iso "${since}"). Check the backup job on the box, then dispatch \`release\`."
  fi
  echo "${last}"
}

# Dumps run hourly at :05 and store copies run at 02:00 UTC. A release can start hours late, so
# it needs the copies made since the most recent 02:00.
dump="$(fresh pg-hourly $((now - 65 * 60)))"
copies="$(fresh nightly $((now - (now - 7200) % 86400)))"
echo "The backup is fresh: the database dump was verified at ${dump}, and the object store and git store copies at ${copies}."
