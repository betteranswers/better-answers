#!/usr/bin/env bash
# Decides, before anything is deployed, whether this run of release.yml releases, and which commit.
set -euo pipefail

: "${GITHUB_OUTPUT:?}" "${GITHUB_STEP_SUMMARY:?}" "${REPOSITORY:?}"
commit="${COMMIT:-}"
mode="${RELEASE_MODE:-per-merge}"

if [ -n "${commit}" ]; then
  trigger=merge
elif [ "${EVENT:-}" = schedule ]; then
  trigger=nightly
else
  trigger=dispatch
fi

emit() {
  printf 'promote=%s\ncommit=%s\ntrigger=%s\n' "$1" "$2" "${trigger}" >>"${GITHUB_OUTPUT}"
}

decide() {
  emit "$1" "$2"
  exit 0
}

skip() {
  echo "::notice::$1"
  printf '### Not released\n\n%s\n' "$1" >>"${GITHUB_STEP_SUMMARY}"
  decide false ""
}

refuse() {
  echo "::error::$1"
  emit false ""
  exit 1
}

case "${mode}" in
  per-merge | nightly | drill) ;;
  *) refuse "RELEASE_MODE is '${mode}', so nothing was released. Set it to per-merge, nightly or drill (for example, gh variable set RELEASE_MODE --body nightly), or delete the variable to use per-merge." ;;
esac

# Tells a skipped run how this mode releases instead.
instead() {
  case "${mode}" in
    per-merge) echo "In per-merge mode, every green build on main is released." ;;
    nightly) echo "In nightly mode, the nightly run releases the newest green commit on main after it confirms a fresh backup." ;;
    drill) echo "In drill mode, dispatch \`release\` and fill \`rehearsed_by\` (RUNBOOK.md page 6)." ;;
  esac
}

merge() {
  [[ "${commit}" =~ ^[0-9a-f]{40}$ ]] || refuse "COMMIT '${commit}' is not a full commit SHA. Pass all 40 hex characters."
  [ "${mode}" = per-merge ] || skip "RELEASE_MODE is ${mode}, so a green build on main is not released automatically. $(instead)"
  local head
  head="$(gh api "repos/${REPOSITORY}/git/ref/heads/main" --jq .object.sha)" ||
    refuse "Could not read the head of main from the GitHub API, so ${commit} was not released. Re-run this job; if main has moved on, the newer commit's build releases instead."
  [ "${head}" = "${commit}" ] ||
    skip "${commit} was not released because the head of main is now ${head}. Production never moves back to an older commit, so the build of ${head} releases instead."
  decide true "${commit}"
}

# Releases the newest commit on main with a green build, unless a released commit comes first.
nightly() {
  [ "${mode}" = nightly ] || skip "RELEASE_MODE is ${mode}, so the nightly run releases nothing. $(instead)"
  local commits green released candidate
  commits="$(gh api "repos/${REPOSITORY}/commits?sha=main&per_page=100" --jq '.[].sha')" ||
    refuse "Could not read the commit history of main from the GitHub API, so nothing was released tonight. Re-run this job."
  green="$(gh api "repos/${REPOSITORY}/actions/workflows/build.yml/runs?branch=main&status=success&per_page=100" --jq '.workflow_runs[].head_sha')" ||
    refuse "Could not read the runs of build.yml from the GitHub API, so nothing was released tonight. Re-run this job."
  released="$(gh api --paginate "repos/${REPOSITORY}/git/matching-refs/tags/release/" --jq '.[].ref')" ||
    refuse "Could not read the release/* tags from the GitHub API, so nothing was released tonight. Re-run this job."
  for candidate in ${commits}; do
    # A tag's name ends in the seven characters of the commit it records.
    if grep -q -- "-${candidate:0:7}\$" <<<"${released}"; then
      skip "Nothing was released tonight: ${candidate} is already released, and no later commit on main has a green build."
    fi
    if grep -qx -- "${candidate}" <<<"${green}"; then
      decide true "${candidate}"
    fi
  done
  refuse "Nothing was released tonight: none of the last 100 commits on main has a green build. Fix the build on main, then dispatch \`release\` or wait for the next nightly run."
}

dispatch() {
  if [ "${mode}" = drill ] && [ -z "${REHEARSED_BY:-}" ]; then
    refuse "RELEASE_MODE is drill, so a dispatched release needs \`rehearsed_by\`. Set it to the report of the restore drill that just passed (drills/drill-<stamp>.md), or to 'hotfix: <reason>'. See RUNBOOK.md page 6."
  fi
  decide true ""
}

"${trigger}"
