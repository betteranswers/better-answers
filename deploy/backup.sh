#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?}" "${BACKUP_AGE_RECIPIENT:?}" "${BACKUP_DUMPS_BUCKET:?}" "${BACKUP_MIRROR_BUCKET:?}" "${GIT_MIRROR_SSH_TARGET:?}"
GIT_STORE=/data/git
STAGING=/staging
NOW=$(date -u +%Y%m%dT%H%M%SZ)

record() {
  psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -qc \
    "insert into backup_run (kind, store, started_at, finished_at, outcome, bytes, location, contains_personal_data, expires_at) values ('$1', '$2', '$3', now(), '$4', $5, '$6', $7, $8)" \
    || echo "backup_run row not written (schema not migrated yet?)" >&2
}
ping() {
  local url=$1 outcome=$2 bytes=${3:-0} secs=${4:-0} suffix=""
  [ "${outcome}" = ok ] || suffix=/fail
  curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "${outcome} bytes=${bytes} took=${secs}" "${url}${suffix}" || true
}
erasure_running() {
  [ "$(psql "${DATABASE_URL}" -At -c 'select pg_try_advisory_lock(41)' 2>/dev/null || echo t)" = f ]
}
verify() {
  local size; size=$(rclone size --json "$2" | jq -r .bytes)
  [ "${size}" = "$(stat -c %s "$1")" ]
}
tier_for_now() {
  local h d w; h=$(date -u +%H) d=$(date -u +%d) w=$(date -u +%u)
  if [ "${h}" = 02 ]; then
    if [ "${d}" = 01 ]; then echo "monthly 6 months"; elif [ "${w}" = 7 ]; then echo "weekly 8 weeks"; else echo "daily 30 days"; fi
  else echo "hourly 48 hours"; fi
}

job_pg() {
  local started t0; started=$(date -u +%FT%TZ); t0=$(date +%s)
  if erasure_running; then echo "erasure routine running — hourly dump skipped"; return 0; fi
  read -r tier life <<<"$(tier_for_now)"
  local file="${STAGING}/pg-${NOW}.dump.age" remote="dumps:${BACKUP_DUMPS_BUCKET}/pg/${tier}/pg-${NOW}.dump.age"
  # pg_dumpall takes no positional DSN: bare, it echoes the password into the log.
  if { pg_dumpall --globals-only --dbname="${DATABASE_URL}" | age -r "${BACKUP_AGE_RECIPIENT}" > "${STAGING}/globals-${NOW}.sql.age"; } \
     && { pg_dump --format=custom --no-owner "${DATABASE_URL}" | age -r "${BACKUP_AGE_RECIPIENT}" > "${file}"; } \
     && rclone copyto --s3-no-check-bucket "${file}" "${remote}" \
     && rclone copyto --s3-no-check-bucket "${STAGING}/globals-${NOW}.sql.age" "dumps:${BACKUP_DUMPS_BUCKET}/pg/${tier}/globals-${NOW}.sql.age" \
     && verify "${file}" "${remote}"; then
    local bytes; bytes=$(stat -c %s "${file}"); rm -f "${file}" "${STAGING}/globals-${NOW}.sql.age"
    record backup postgres "${started}" ok "${bytes}" "pg/${tier}/pg-${NOW}.dump.age" true "now() + interval '${life}'"
    ping "${HEALTHCHECKS_PING_URL_PG_HOURLY:?}" ok "${bytes}" $(( $(date +%s) - t0 ))
  else
    record backup postgres "${started}" failed 0 "" true NULL
    ping "${HEALTHCHECKS_PING_URL_PG_HOURLY:?}" fail; exit 1
  fi
}

job_mirror() {
  local started; started=$(date -u +%FT%TZ)
  if rclone sync --s3-no-check-bucket --fast-list src: "dumps:${BACKUP_MIRROR_BUCKET}/objectstore/" \
     && rclone check --one-way --size-only src: "dumps:${BACKUP_MIRROR_BUCKET}/objectstore/" >/dev/null 2>&1; then
    record backup objectstore "${started}" ok 0 "objectstore/" true "now() + interval '30 days'"
  else record backup objectstore "${started}" failed 0 "" true NULL; return 1; fi
}

job_bundles() {
  local started rc=0; started=$(date -u +%FT%TZ)
  while read -r repo; do
    ws=$(basename "${repo}" .git); out="${STAGING}/${ws}-${NOW}.bundle.age"
    git -C "${repo}" bundle create "${STAGING}/${ws}.bundle" --all \
      && git bundle verify "${STAGING}/${ws}.bundle" >/dev/null \
      && age -r "${BACKUP_AGE_RECIPIENT}" -o "${out}" "${STAGING}/${ws}.bundle" \
      && rclone copyto --s3-no-check-bucket "${out}" "dumps:${BACKUP_DUMPS_BUCKET}/git/${ws}/${ws}-${NOW}.bundle.age" \
      && verify "${out}" "dumps:${BACKUP_DUMPS_BUCKET}/git/${ws}/${ws}-${NOW}.bundle.age" || rc=1
    rm -f "${STAGING}/${ws}.bundle" "${out}"
  done < <(find "${GIT_STORE}" -mindepth 1 -maxdepth 1 -type d -name '*.git')
  if [ "${rc}" -eq 0 ]; then record backup git "${started}" ok 0 "git/" true "now() + interval '30 days'"; else record backup git "${started}" failed 0 "" true NULL; fi
  return "${rc}"
}

job_git_mirror() {
  local started rc=0; started=$(date -u +%FT%TZ)
  while read -r repo; do
    ws=$(basename "${repo}" .git)
    ssh -o BatchMode=yes "${GIT_MIRROR_SSH_TARGET%%:*}" init-repo "${ws}" >/dev/null || { rc=1; continue; }
    if ! pushed=$(git -C "${repo}" push --mirror --porcelain "${GIT_MIRROR_SSH_TARGET}/${ws}.git"); then rc=1; continue; fi
    # The objects a rewrite replaced stay readable there through the reflog until pruned.
    if printf '%s\n' "${pushed}" | grep -qE '^[+-]'; then
      ssh -o BatchMode=yes "${GIT_MIRROR_SSH_TARGET%%:*}" prune-repo "${ws}" >/dev/null || rc=1
    fi
  done < <(find "${GIT_STORE}" -mindepth 1 -maxdepth 1 -type d -name '*.git')
  if [ "${rc}" -eq 0 ]; then record backup git-mirror "${started}" ok 0 "mirror/" true NULL; else record backup git-mirror "${started}" failed 0 "" true NULL; fi
  return "${rc}"
}

# Anything left here for a day is a failed upload of personal data.
find "${STAGING}" -type f -mmin +1440 -delete || true

case "${1:-}" in
  hourly)  job_pg ;;
  nightly) t0=$(date +%s)
           if job_mirror && job_bundles && job_git_mirror; then ping "${HEALTHCHECKS_PING_URL_NIGHTLY:?}" ok 0 $(( $(date +%s) - t0 )); else ping "${HEALTHCHECKS_PING_URL_NIGHTLY:?}" fail; exit 1; fi ;;
  *) echo "usage: backup.sh hourly|nightly" >&2; exit 2 ;;
esac
