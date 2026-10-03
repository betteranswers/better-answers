#!/usr/bin/env bash
# The ping URL is a secret, so no line names it: curl runs without -S, whose errors name the host.
set -euo pipefail

refuse() {
  echo "::error::usage: journeys-ping.sh <held|fail|could-not-run> — $1" >&2
  exit 2
}

[ "$#" -eq 1 ] || refuse "takes one argument, and was given $#"
case "$1" in
  held) suffix="" ;;
  fail | could-not-run) suffix="/fail" ;;
  *) refuse "$1 is not one of the three outcome words" ;;
esac
word="$1"
: "${GITHUB_STEP_SUMMARY:?}"

# A ping that misses never fails the run: the journeys' word is its outcome, not the ping's.
unpinged() {
  echo "::warning::The journeys check was not pinged: $1"
  echo "The journeys check was not pinged: $1" >>"${GITHUB_STEP_SUMMARY}"
  exit 0
}

[ -n "${JOURNEYS_PING_URL:-}" ] ||
  unpinged "JOURNEYS_PING_URL is not set in the production environment (RUNBOOK.md page 13, step 3)."

attempts="${JOURNEYS_PING_ATTEMPTS:-3}"
delay="${JOURNEYS_PING_DELAY_SECONDS:-5}"

code="no answer"
for ((attempt = 1; attempt <= attempts; attempt++)); do
  code="$(curl -s --max-redirs 0 --max-time 10 -o /dev/null -w '%{http_code}' \
    -H 'Content-Type: text/plain' --data-raw "${word}" "${JOURNEYS_PING_URL}${suffix}")" || code="no answer"
  if [[ "${code}" == 2?? ]]; then
    echo "pinged the journeys check: ${word}"
    exit 0
  fi
  if ((attempt < attempts)); then sleep "${delay}"; fi
done
unpinged "${attempts} attempts went undelivered (the last answer: ${code})."
