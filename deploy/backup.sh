#!/usr/bin/env bash
# Better Answers — backup jobs (apps/docs-site/operations/BACKUPS.md). Runs inside the `backup` service.
#   backup.sh hourly   — Postgres dump, age-encrypted, filed into the tier the clock says
#                        (hourly; 02:05 → daily; Sunday 02:05 → weekly; 1st 02:05 → monthly)
#   backup.sh nightly  — object-store mirror (rclone sync — deletions propagate) + one git bundle per bare
#                        repository under /data/git + `git push --mirror` of each to VPC 2 (ADR 0024)
# Every job: verify the upload against the bucket, write a backup_run row, THEN ping. The ping body
# is the outcome word and sizes only — never a path, key, workspace or error string (research 69).
# A dump that never uploads is a missed ping, not a success.
# Pauses while the erasure routine runs: the routine takes `pg_advisory_lock(41)`; we try-lock it.
set -euo pipefail

: "${DATABASE_URL:?}" "${BACKUP_AGE_RECIPIENT:?}" "${BACKUP_DUMPS_BUCKET:?}" "${BACKUP_MIRROR_BUCKET:?}" "${GIT_MIRROR_SSH_TARGET:?}"
GIT_STORE=/data/git   # bare repositories, one per workspace, mounted read-only (stores.compose.yaml)
STAGING=/staging
NOW=$(date -u +%Y%m%dT%H%M%SZ)

record() { # record <kind> <store> <started> <outcome> <bytes> <location> <personal> <expires_at|NULL>
  psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -qc \
    "insert into backup_run (kind, store, started_at, finished_at, outcome, bytes, location, contains_personal_data, expires_at) values ('$1', '$2', '$3', now(), '$4', $5, '$6', $7, $8)" \
    || echo "backup_run row not written (schema not migrated yet?)" >&2
}
ping() { # ping <url> <outcome> [<bytes> <seconds>]  — body: "ok bytes=N took=S" / "fail"
  local url=$1 outcome=$2 bytes=${3:-0} secs=${4:-0} suffix=""
  [ "${outcome}" = ok ] || suffix=/fail
  curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "${outcome} bytes=${bytes} took=${secs}" "${url}${suffix}" || true
}
erasure_running() { # true when the erasure routine holds the lock (ADR 0020): skip this tick
  [ "$(psql "${DATABASE_URL}" -At -c 'select pg_try_advisory_lock(41)' 2>/dev/null || echo t)" = f ]
}
verify() { # verify <local file> <remote path> — size must match what the bucket reports
  local size; size=$(rclone size --json "$2" | jq -r .bytes)
  [ "${size}" = "$(stat -c %s "$1")" ]
}
tier_for_now() { # the tier and its lifetime — mirrors the bucket lifecycle rules (BACKUPS.md)
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
  # `--dbname=`: pg_dumpall takes no positional DSN — passed bare it errors "too many
  # command-line arguments" AND echoes the full DSN, password included, into the log
  # (first backup run, 04/09/2026).
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

job_mirror() { # uploads + normalised text (transient bindings) → the MIRROR bucket: versioned, no lock, deletions propagate
  local started; started=$(date -u +%FT%TZ)
  if rclone sync --s3-no-check-bucket --fast-list src: "dumps:${BACKUP_MIRROR_BUCKET}/objectstore/" \
     && rclone check --one-way --size-only src: "dumps:${BACKUP_MIRROR_BUCKET}/objectstore/" >/dev/null 2>&1; then
    record backup objectstore "${started}" ok 0 "objectstore/" true "now() + interval '30 days'"
  else record backup objectstore "${started}" failed 0 "" true NULL; return 1; fi
}

job_bundles() { # one verified `git bundle --all` per bare repository, age-encrypted, nightly
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

job_git_mirror() { # the second copy: every bare repository force-mirrored to VPC 2 over SSH under the deploy key
  # --mirror so a history rewrite by the erasure routine replaces the mirror's refs rather than adding to them
  local started rc=0; started=$(date -u +%FT%TZ)
  while read -r repo; do
    ws=$(basename "${repo}" .git)
    # the mirror key's forced command is deploy/mirror-shell.sh: `init-repo <ws>` (creates the bare target if absent) and git-receive-pack, nothing else
    ssh -o BatchMode=yes "${GIT_MIRROR_SSH_TARGET%%:*}" init-repo "${ws}" >/dev/null || { rc=1; continue; }
    git -C "${repo}" push --mirror --quiet "${GIT_MIRROR_SSH_TARGET}/${ws}.git" || rc=1
  done < <(find "${GIT_STORE}" -mindepth 1 -maxdepth 1 -type d -name '*.git')
  if [ "${rc}" -eq 0 ]; then record backup git-mirror "${started}" ok 0 "mirror/" true NULL; else record backup git-mirror "${started}" failed 0 "" true NULL; fi
  return "${rc}"
}

# anything left in /staging for a day is a failed upload of personal data: delete it (research 69)
find "${STAGING}" -type f -mmin +1440 -delete || true

case "${1:-}" in
  hourly)  job_pg ;;
  nightly) t0=$(date +%s)
           if job_mirror && job_bundles && job_git_mirror; then ping "${HEALTHCHECKS_PING_URL_NIGHTLY:?}" ok 0 $(( $(date +%s) - t0 )); else ping "${HEALTHCHECKS_PING_URL_NIGHTLY:?}" fail; exit 1; fi ;;
  *) echo "usage: backup.sh hourly|nightly" >&2; exit 2 ;;
esac
