#!/usr/bin/env bash
# A journeys job that wrote no word still reports one, so the check hears from every run that owed it.
set -euo pipefail

: "${GITHUB_STEP_SUMMARY:?}"

case "${WORD:-}" in
  held)
    word=held
    said="Every journey passed against the release production runs."
    ;;
  fail)
    word=fail
    said="A journey failed, or a sign-in email did not reach the test inbox in time. The journeys' table above names the role, the page and the step (RUNBOOK.md page 13)."
    ;;
  could-not-run)
    word=could-not-run
    said="The journeys could not run. The journeys' table above names the cause (RUNBOOK.md page 13)."
    ;;
  *)
    # A cancel or a refusal says nothing of the release, so only a promote that failed reads fail.
    if [ "${REFUSED:-}" = true ]; then
      word=could-not-run
      said="The gate refused this run, so the journeys did not run: ${REFUSAL:-it gave no reason} (RUNBOOK.md page 6)"
    elif [ "${JOURNEYS:-}" = skipped ] && [ "${PROMOTE:-}" = failure ]; then
      word=fail
      said="The promote failed, so the journeys did not run (RUNBOOK.md page 6)."
    elif [ "${JOURNEYS:-}" = skipped ] && [ "${PROMOTE:-}" = cancelled ]; then
      word=could-not-run
      said="The promote was cancelled, so the journeys did not run (RUNBOOK.md page 6)."
    else
      word=could-not-run
      said="The journeys ended without an outcome word: their job stopped before the journeys ran, or was cancelled or timed out (RUNBOOK.md page 13)."
    fi
    ;;
esac

# A blank line after, so a line the ping adds starts a paragraph of its own.
printf '### Journeys: %s\n\n%s\n\n' "${word}" "${said}" >>"${GITHUB_STEP_SUMMARY}"
"$(dirname "$0")/journeys-ping.sh" "${word}"
