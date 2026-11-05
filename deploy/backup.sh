#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?}" "${BACKUP_AGE_RECIPIENT:?}" "${BACKUP_DUMPS_BUCKET:?}" "${BACKUP_MIRROR_BUCKET:?}" "${GIT_MIRROR_SSH_TARGET:?}"
GIT_STORE=/data/git
STAGING=/staging
NOW=$(date -u +%Y%m%dT%H%M%SZ)
JOB=${1:-}

# >>> record the copy
record() {
  psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -qc \
    "insert into backup (kind, store, started_at, finished_at, outcome, bytes, location, contains_personal_data, expires_at) values ('backup', '$1', '$2', now(), '$3', ${4:-NULL}, nullif('${5:-}', ''), true, now() + nullif('${6:-}', '')::interval)" \
    || echo "backup row not written" >&2
}
# <<< record the copy
ping() {
  local url=$1 outcome=$2 body="$2 bytes=${3:-0} took=${4:-0}" suffix=""
  [ "${outcome}" = ok ] || suffix=/fail
  curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "${body}" "${url}${suffix}" || true
  echo "backup.sh ${JOB}: ${body}"
}
# `bundle verify` must run inside a repository. On success it prints the bundle's path to
# stderr, so drop that line before it reaches the log.
bundle_verifies() {
  git -C "$1" bundle verify --quiet "$2" 2>&1 | { grep -v ' is okay$' || true; } >&2
}
erasure_running() {
  [ "$(psql "${DATABASE_URL}" -At -c 'select pg_try_advisory_lock(41)' 2>/dev/null || echo t)" = f ]
}
verify() {
  local size; size=$(rclone size --json "$2" | jq -r .bytes)
  [ "${size}" = "$(stat -c %s "$1")" ]
}
# Skips a repository with no ref yet, which `bundle create` and `push --mirror` refuse.
# Lists an unreadable repository so that its job fails.
repositories() {
  local repo refs
  while read -r repo; do
    if refs=$(git -C "${repo}" for-each-ref --count=1) && [ -z "${refs}" ]; then continue; fi
    printf '%s\n' "${repo}"
  done < <(find "${GIT_STORE}" -mindepth 1 -maxdepth 1 -type d -name '*.git')
}
tier_for_now() {
  local h d w; h=$(date -u +%H) d=$(date -u +%d) w=$(date -u +%u)
  if [ "${h}" = 02 ]; then
    if [ "${d}" = 01 ]; then echo "monthly 6 months"; elif [ "${w}" = 7 ]; then echo "weekly 8 weeks"; else echo "daily 30 days"; fi
  else echo "hourly 48 hours"; fi
}

job_pg() {
  local started t0; started=$(date -u +%FT%TZ); t0=$(date +%s)
  if erasure_running; then echo "hourly dump skipped: an erasure is running"; return 0; fi
  read -r tier life <<<"$(tier_for_now)"
  local file="${STAGING}/pg-${NOW}.dump.age" remote="dumps:${BACKUP_DUMPS_BUCKET}/pg/${tier}/pg-${NOW}.dump.age"
  # Pass the DSN with --dbname: pg_dumpall takes no positional DSN and would print the password to the log.
  if { pg_dumpall --globals-only --dbname="${DATABASE_URL}" | age -r "${BACKUP_AGE_RECIPIENT}" > "${STAGING}/globals-${NOW}.sql.age"; } \
     && { pg_dump --format=custom --no-owner "${DATABASE_URL}" | age -r "${BACKUP_AGE_RECIPIENT}" > "${file}"; } \
     && rclone copyto --s3-no-check-bucket "${file}" "${remote}" \
     && rclone copyto --s3-no-check-bucket "${STAGING}/globals-${NOW}.sql.age" "dumps:${BACKUP_DUMPS_BUCKET}/pg/${tier}/globals-${NOW}.sql.age" \
     && verify "${file}" "${remote}"; then
    local bytes; bytes=$(stat -c %s "${file}"); rm -f "${file}" "${STAGING}/globals-${NOW}.sql.age"
    record postgres "${started}" ok "${bytes}" "pg/${tier}/pg-${NOW}.dump.age" "${life}"
    ping "${HEALTHCHECKS_PING_URL_PG_HOURLY:?}" ok "${bytes}" $(( $(date +%s) - t0 ))
  else
    record postgres "${started}" failed
    ping "${HEALTHCHECKS_PING_URL_PG_HOURLY:?}" fail; exit 1
  fi
}

job_mirror() {
  local started; started=$(date -u +%FT%TZ)
  if rclone sync --s3-no-check-bucket --fast-list src: "dumps:${BACKUP_MIRROR_BUCKET}/objectstore/" \
     && rclone check --one-way --size-only src: "dumps:${BACKUP_MIRROR_BUCKET}/objectstore/" >/dev/null 2>&1; then
    record objectstore "${started}" ok "" objectstore/ "30 days"
  else record objectstore "${started}" failed; return 1; fi
}

job_bundles() {
  local started rc=0; started=$(date -u +%FT%TZ)
  while read -r repo; do
    ws=$(basename "${repo}" .git); out="${STAGING}/${ws}-${NOW}.bundle.age"
    git -C "${repo}" bundle create "${STAGING}/${ws}.bundle" --all \
      && bundle_verifies "${repo}" "${STAGING}/${ws}.bundle" \
      && age -r "${BACKUP_AGE_RECIPIENT}" -o "${out}" "${STAGING}/${ws}.bundle" \
      && rclone copyto --s3-no-check-bucket "${out}" "dumps:${BACKUP_DUMPS_BUCKET}/git/${ws}/${ws}-${NOW}.bundle.age" \
      && verify "${out}" "dumps:${BACKUP_DUMPS_BUCKET}/git/${ws}/${ws}-${NOW}.bundle.age" || rc=1
    rm -f "${STAGING}/${ws}.bundle" "${out}"
  done < <(repositories)
  if [ "${rc}" -eq 0 ]; then record git "${started}" ok "" git/ "30 days"; else record git "${started}" failed; fi
  return "${rc}"
}

job_git_mirror() {
  local started rc=0; started=$(date -u +%FT%TZ)
  while read -r repo; do
    ws=$(basename "${repo}" .git)
    # -n stops ssh reading stdin, which holds the rest of this loop's repository list.
    ssh -n -o BatchMode=yes "${GIT_MIRROR_SSH_TARGET%%:*}" init-repo "${ws}" >/dev/null || { rc=1; continue; }
    if ! pushed=$(git -C "${repo}" push --mirror --porcelain "${GIT_MIRROR_SSH_TARGET}/${ws}.git"); then rc=1; continue; fi
    # After a rewrite, the mirror's reflog keeps the replaced objects readable until they are pruned.
    if printf '%s\n' "${pushed}" | grep -qE '^[+-]'; then
      ssh -n -o BatchMode=yes "${GIT_MIRROR_SSH_TARGET%%:*}" prune-repo "${ws}" >/dev/null || rc=1
    fi
  done < <(repositories)
  if [ "${rc}" -eq 0 ]; then record git-mirror "${started}" ok "" mirror/; else record git-mirror "${started}" failed; fi
  return "${rc}"
}

# A file left here for a day is personal data from a failed upload, so delete it.
find "${STAGING}" -type f -mmin +1440 -delete || true

case "${1:-}" in
  hourly)  job_pg ;;
  nightly) t0=$(date +%s)
           if job_mirror && job_bundles && job_git_mirror; then ping "${HEALTHCHECKS_PING_URL_NIGHTLY:?}" ok 0 $(( $(date +%s) - t0 )); else ping "${HEALTHCHECKS_PING_URL_NIGHTLY:?}" fail; exit 1; fi ;;
  *) echo "usage: backup.sh hourly|nightly" >&2; exit 2 ;;
esac
