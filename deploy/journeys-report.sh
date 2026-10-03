#!/usr/bin/env bash
# The release's last word on its journeys: the word they wrote, or the one their job's result
# implies when they wrote none, to the run's summary and then to the journeys check.
set -euo pipefail

: "${GITHUB_STEP_SUMMARY:?}"

case "${WORD:-}" in
  held)
    word=held
    said="Every journey passed against the release production runs."
    ;;
  fail)
    word=fail
    said="A journey failed, or a sign-in email did not reach the test inbox in time. The journeys' table above names the role, the screen and the step (RUNBOOK.md page 13)."
    ;;
  could-not-run)
    word=could-not-run
    said="The journeys could not run. The journeys' table above names the cause (RUNBOOK.md page 13)."
    ;;
  *)
    # The report runs only when the journeys were due, so a skipped journeys job means the promote failed.
    if [ "${JOURNEYS:-}" = skipped ]; then
      word=fail
      said="The promote failed, so the journeys did not run (RUNBOOK.md page 6)."
    else
      word=could-not-run
      said="The journeys ended without an outcome word: their job stopped before the journeys ran, or was cancelled or timed out (RUNBOOK.md page 13)."
    fi
    ;;
esac

# A blank line after, so a line the ping adds starts a paragraph of its own.
printf '### Journeys: %s\n\n%s\n\n' "${word}" "${said}" >>"${GITHUB_STEP_SUMMARY}"
"$(dirname "$0")/journeys-ping.sh" "${word}"
