#!/usr/bin/env bash
# The old build answers /health as healthy until the container swap, so wait until /health also names the expected digest.
set -euo pipefail

refuse() {
  echo "::error::usage: await-release.sh <origin> <api digest>. $1" >&2
  exit 2
}

[ "$#" -eq 2 ] || refuse "Pass two arguments; got $#."
origin="$1"
expected="$2"
[[ "${expected}" =~ ^sha256:[0-9a-f]{64}$ ]] || refuse "${expected} is not a digest. Pass sha256: followed by 64 hex characters."
{ command -v curl && command -v jq; } >/dev/null || refuse "curl and jq must both be on PATH. Install the missing one."

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
    echo "Production reports healthy on ${expected}."
    exit 0
  fi
  echo "poll ${poll}/${polls}: status ${status}, image ${named:-none reported}"
  last_named="${named:-${last_named}}"
  if ((poll < polls)); then sleep "${delay}"; fi
done

earlier=""
if [ -n "${last_named}" ] && [ "${last_named}" != "${named}" ]; then
  earlier=" The last image any answer reported was ${last_named}."
fi
echo "::error::Production's /health did not report healthy on the promoted api image after ${polls} polls, ${delay} s apart. Expected image: ${expected}. Last image reported: ${named:-none}. Last status: ${status}.${earlier} See \"Read a red smoke\" in RUNBOOK.md." >&2
exit 1
