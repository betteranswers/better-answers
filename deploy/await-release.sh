#!/usr/bin/env bash
# The build being replaced answers /health healthy until the container swaps, so a 200 alone proves nothing.
set -euo pipefail

refuse() {
  echo "::error::usage: await-release.sh <origin> <api digest> — $1" >&2
  exit 2
}

[ "$#" -eq 2 ] || refuse "takes two arguments, and was given $#"
origin="$1"
expected="$2"
[[ "${expected}" =~ ^sha256:[0-9a-f]{64}$ ]] || refuse "${expected} is not a digest (sha256: followed by 64 hex characters)"
command -v curl >/dev/null && command -v jq >/dev/null || refuse "curl and jq must both be on PATH"

# Six minutes from first poll to last, twice the three a fresh pull took; even with every poll timing out, inside the job's timeout.
polls="${AWAIT_RELEASE_POLLS:-61}"
delay="${AWAIT_RELEASE_DELAY_SECONDS:-6}"

status="no health answer"
named=""
last_named=""
for ((poll = 1; poll <= polls; poll++)); do
  body="$(curl -s --max-time 5 "${origin}/health")" || body=""
  status="$(jq -r '.status // empty' <<<"${body}" 2>/dev/null)" || status=""
  status="${status:-no health answer}"
  named="$(jq -r '.image // empty' <<<"${body}" 2>/dev/null)" || named=""
  if [ "${status}" = "healthy" ] && [ "${named}" = "${expected}" ]; then
    echo "production answers healthy on ${expected}"
    exit 0
  fi
  echo "poll ${poll}/${polls}: ${status}, ${named:-no image named}"
  last_named="${named:-${last_named}}"
  if ((poll < polls)); then sleep "${delay}"; fi
done

earlier=""
if [ -n "${last_named}" ] && [ "${last_named}" != "${named}" ]; then
  earlier="; the last image named was ${last_named}"
fi
echo "::error::production's /health never answered healthy on the promoted api image in ${polls} polls ${delay} s apart: expected ${expected}, answering ${named:-no image named} (the last answer: ${status}${earlier})" >&2
exit 1
