#!/usr/bin/env bash
# Decides, before anything is deployed, whether this run of release.yml promotes, and which commit,
# and whether the journeys run against the live release instead.
set -euo pipefail

: "${GITHUB_OUTPUT:?}" "${GITHUB_STEP_SUMMARY:?}" "${REPOSITORY:?}"
commit="${COMMIT:-}"
mode="${RELEASE_MODE:-per-merge}"
journeys_mode="${JOURNEYS_MODE:-off}"
journeys_only=false

if [ -n "${commit}" ]; then
  trigger=merge
elif [ "${EVENT:-}" = schedule ]; then
  trigger=nightly
else
  trigger=dispatch
fi

decide() {
  printf 'promote=%s\ncommit=%s\ntrigger=%s\njourneys_only=%s\njourneys_mode=%s\n' \
    "$1" "$2" "${trigger}" "${journeys_only}" "${journeys_mode}" >>"${GITHUB_OUTPUT}"
  exit 0
}

skip() {
  echo "::notice::$1"
  printf '### Not released\n\n%s\n' "$1" >>"${GITHUB_STEP_SUMMARY}"
  decide false ""
}

# A refused night or journeys-only run still owes the alert a word, so the report job reads why.
refuse() {
  echo "::error::$1"
  local due=false
  if [ "${trigger}" = nightly ] || [ "${JOURNEYS_ONLY:-false}" = true ]; then due=true; fi
  printf 'promote=false\ncommit=\ntrigger=%s\njourneys_only=false\njourneys_mode=%s\nrefused=%s\nrefusal=%s\n' \
    "${trigger}" "${journeys_mode}" "${due}" "$1" >>"${GITHUB_OUTPUT}"
  exit 1
}

case "${mode}" in
  per-merge | nightly | drill) ;;
  *) refuse "RELEASE_MODE is '${mode}', which is not per-merge, nightly or drill, so nothing is released. Set one (gh variable set RELEASE_MODE --body nightly), or delete it for per-merge" ;;
esac

case "${journeys_mode}" in
  off | report | gate) ;;
  *) refuse "JOURNEYS_MODE is '${journeys_mode}', which is not off, report or gate, so nothing is released. Set one (gh variable set JOURNEYS_MODE --body report), or delete it for off" ;;
esac

LIVE="The journeys run against the live release."

# A scheduled run that promotes nothing still runs the journeys, so the alert hears every night.
quiet_night() {
  if [ "${journeys_mode}" = off ]; then
    skip "$1"
  fi
  journeys_only=true
  skip "$1 ${LIVE}"
}

# What releases instead, told to a release that is skipped.
instead() {
  case "${mode}" in
    per-merge) echo "Every green build on main releases itself." ;;
    nightly) echo "The nightly release promotes main's newest green commit after a fresh backup." ;;
    drill) echo "Dispatch \`release\` with \`rehearsed_by\` (RUNBOOK.md page 6)." ;;
  esac
}

merge() {
  [[ "${commit}" =~ ^[0-9a-f]{40}$ ]] || refuse "commit is not a full commit sha (40 hex characters)"
  [ "${mode}" = per-merge ] || skip "RELEASE_MODE is ${mode}, so a green build does not release itself. $(instead)"
  local head
  head="$(gh api "repos/${REPOSITORY}/git/ref/heads/main" --jq .object.sha)" ||
    refuse "main's head could not be read, so ${commit} is not released: a newer commit may already be the head"
  [ "${head}" = "${commit}" ] ||
    skip "${commit} is no longer main's head; ${head} is. Production never goes back to an older commit, so a newer commit's green build releases in its place."
  decide true "${commit}"
}

# The newest commit on main with a green build, unless a release or a rejection is reached first.
nightly() {
  [ "${mode}" = nightly ] || quiet_night "RELEASE_MODE is ${mode}, so the nightly release has nothing to do. $(instead)"
  local commits green released rejected candidate
  commits="$(gh api "repos/${REPOSITORY}/commits?sha=main&per_page=100" --jq '.[].sha')" ||
    refuse "main's history could not be read, so nothing is released tonight"
  green="$(gh api "repos/${REPOSITORY}/actions/workflows/build.yml/runs?branch=main&status=success&per_page=100" --jq '.workflow_runs[].head_sha')" ||
    refuse "build.yml's runs could not be read, so nothing is released tonight"
  released="$(gh api --paginate "repos/${REPOSITORY}/git/matching-refs/tags/release/" --jq '.[].ref')" ||
    refuse "the release tags could not be read, so nothing is released tonight"
  rejected="$(gh api --paginate "repos/${REPOSITORY}/git/matching-refs/tags/rejected/" --jq '.[].ref')" ||
    refuse "the rejected tags could not be read, so nothing is released tonight"
  for candidate in ${commits}; do
    # A tag's name ends in the seven characters of the commit it records.
    if grep -q -- "-${candidate:0:7}\$" <<<"${released}"; then
      quiet_night "${candidate} is the newest release on main, and no commit after it has a green build, so nothing is released tonight."
    fi
    # A rejection bounds the walk as a release does, so production never moves back past it.
    if grep -q -- "-${candidate:0:7}\$" <<<"${rejected}"; then
      quiet_night "${candidate} was rejected by its journeys, and no commit after it has a green build, so nothing is released tonight. Delete its rejected/ tag to promote it again."
    fi
    if grep -qx -- "${candidate}" <<<"${green}"; then
      decide true "${candidate}"
    fi
  done
  refuse "none of main's last 100 commits has a green build, so nothing is released tonight"
}

# Read before drill mode's refusal, which guards promotions and not this.
journeys_dispatch() {
  [ "${journeys_mode}" != off ] ||
    skip "JOURNEYS_MODE is off, so a journeys-only dispatch has nothing to run. Set it to report (RUNBOOK.md page 13)"
  journeys_only=true
  local said="A journeys-only dispatch: nothing is promoted or tagged. ${LIVE}"
  echo "::notice::${said}"
  printf '### Journeys only\n\n%s\n' "${said}" >>"${GITHUB_STEP_SUMMARY}"
  decide false ""
}

dispatch() {
  [ "${JOURNEYS_ONLY:-false}" != true ] || journeys_dispatch
  if [ "${mode}" = drill ] && [ -z "${REHEARSED_BY:-}" ]; then
    refuse "RELEASE_MODE is drill: a release must ride a drill that just proved a restore, or state a hotfix reason. Fill \`rehearsed_by\` (RUNBOOK.md page 6)"
  fi
  decide true ""
}

"${trigger}"
