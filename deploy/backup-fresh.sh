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

# Prints the check's last ping, or refuses: exactly one check, up, pinged within the minutes given.
fresh() {
  local slug="$1" minutes="$2" answer code status last pinged age
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
  age=$(((now - pinged) / 60))
  if [ "${status}" != up ] || [ "${age}" -gt "${minutes}" ]; then
    refuse "the ${slug} backup is not fresh: its check is ${status}, last pinged ${last}, ${age} minutes ago, where ${minutes} is the most allowed, so nothing is released"
  fi
  echo "${last}"
}

# The dump runs at five past each hour, and the nightly copy of the object and git stores at 02:00.
dump="$(fresh pg-hourly 65)"
copies="$(fresh nightly 180)"
echo "the box's own backup: the database dump verified at ${dump}, the object and git store copies at ${copies}"
