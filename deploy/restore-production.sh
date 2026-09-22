#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?the production owner DSN}" "${REPO_DIR:?}" "${PLATFORM_ENV_FILE:?}" "${STORES_ENV_FILE:?}"
: "${BACKUP_DUMPS_BUCKET:?}" "${BACKUP_MIRROR_BUCKET:?}" "${BACKUP_AGE_IDENTITY_FILE:?from escrow, for this restore only}"
[ -s "${BACKUP_AGE_IDENTITY_FILE}" ] || { echo "the identity file is empty or missing" >&2; exit 1; }

dump=latest; tier=daily; objectstore=no; git=no; yes=no
while [ $# -gt 0 ]; do
  case "$1" in
    --dump) dump=$2; shift 2 ;;
    --tier) tier=$2; shift 2 ;;
    --objectstore) objectstore=yes; shift ;;
    --git) git=yes; shift ;;
    --yes) yes=yes; shift ;;
    *) echo "usage: restore-production.sh --dump latest|<file> [--tier daily] [--objectstore] [--git] [--yes]" >&2; exit 2 ;;
  esac
done

WORK=$(mktemp -d); chmod 700 "${WORK}"; T0=$(date +%s); LOG="/var/log/better-answers-restore-$(date -u +%Y%m%dT%H%M%SZ).log"
say() { printf '%s %s\n' "$(date -u +%T)" "$*" | tee -a "${LOG}"; }
compose() { docker compose --project-directory "${REPO_DIR}/deploy" "$@"; }
stores()   { compose --env-file "${STORES_ENV_FILE}" -f stores.compose.yaml -p better-answers-stores "$@"; }
platform() { compose --env-file "${PLATFORM_ENV_FILE}" -f platform.compose.yaml -p better-answers "$@"; }
tool() { stores run --rm --no-deps -v "${WORK}:/work" -v "${BACKUP_AGE_IDENTITY_FILE}:/run/age.key:ro" backup "$@"; }
rclone() { tool rclone "$@"; }
cleanup_work() { rm -rf "${WORK}"; }

say "# Production restore — dump=${dump} tier=${tier} objectstore=${objectstore} git=${git}"

say "## 0 the copy"
if [ "${dump}" = latest ]; then
  dump=$(rclone lsf "dumps:${BACKUP_DUMPS_BUCKET}/pg/${tier}/" | grep '^pg-' | sort | tail -n1)
fi
[ -n "${dump}" ] || { say "no dump found under pg/${tier}/"; exit 1; }
stamp=$(echo "${dump}" | sed -E 's/^pg-([0-9T]+Z)\..*/\1/')
globals=$(rclone lsf "dumps:${BACKUP_DUMPS_BUCKET}/pg/${tier}/" | grep "^globals-${stamp}" | head -n1)
say "restoring ${dump} (taken ${stamp}) — every write since then is lost; every erasure since then is replayed"
if [ "${yes}" != yes ]; then printf 'Type the dump timestamp (%s) to continue: ' "${stamp}"; read -r typed; [ "${typed}" = "${stamp}" ] || { say "aborted"; exit 1; }; fi

say "## 1 stop the platform stack — nothing writes while the database is replaced (the stores stack stays up)"
platform stop api || true

say "## 2 postgres"
rclone copyto "dumps:${BACKUP_DUMPS_BUCKET}/pg/${tier}/${dump}" "/work/pg.dump.age"
[ -z "${globals}" ] || rclone copyto "dumps:${BACKUP_DUMPS_BUCKET}/pg/${tier}/${globals}" "/work/globals.sql.age"
[ ! -f "${WORK}/globals.sql.age" ] || tool sh -c 'age -d -i /run/age.key /work/globals.sql.age | psql "$DATABASE_URL" -q' || true
tool age -d -i /run/age.key -o /work/pg.dump /work/pg.dump.age
tool sh -c 'pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" /work/pg.dump'
rm -f "${WORK}/pg.dump" "${WORK}/pg.dump.age" "${WORK}/globals.sql.age"
say "restored — RPO $(( ( $(date +%s) - $(date -d "${stamp:0:8} ${stamp:9:2}:${stamp:11:2}" +%s) ) / 60 )) min"

say "## 3 migrate — the schema the restored dump carries, brought forward"
platform run --rm migrate

if [ "${objectstore}" = yes ]; then
  say "## 4 object store — mirror back from the MIRROR bucket (deletions there are erasures: they stay deleted)"
  stores run --rm --no-deps backup rclone sync "dumps:${BACKUP_MIRROR_BUCKET}/objectstore/" src:/
fi

if [ "${git}" = yes ]; then
  say "## 5 git store — one bare repository per workspace from its latest bundle"
  if [ -n "$(ls -A /data/git 2>/dev/null)" ]; then say "REFUSED: /data/git is not empty — the live repositories are newer than any bundle; clear it deliberately first, or clone from the VPC 2 mirror"; exit 1; fi
  for ws in $(rclone lsf --dirs-only "dumps:${BACKUP_DUMPS_BUCKET}/git/" | tr -d '/\r'); do
    b=$(rclone lsf "dumps:${BACKUP_DUMPS_BUCKET}/git/${ws}/" | sort | tail -n1 | tr -d '\r')
    rclone copyto "dumps:${BACKUP_DUMPS_BUCKET}/git/${ws}/${b}" "/work/${ws}.bundle.age"
    tool age -d -i /run/age.key -o "/work/${ws}.bundle" "/work/${ws}.bundle.age"
    chmod 644 "${WORK}/${ws}.bundle"
    sudo -u '#1000' git clone --quiet --bare "${WORK}/${ws}.bundle" "/data/git/${ws}.git"
    rm -f "${WORK}/${ws}.bundle" "${WORK}/${ws}.bundle.age"
  done
fi
cleanup_work

say "## 6 REPLAY ERASURES completed after ${stamp} — mandatory; a failure here leaves api stopped"
platform run --rm --no-deps api pnpm ops replay-erasures --since "${stamp}" | tee -a "${LOG}"

say "## 7 start api and prove it answers"
platform up -d --wait api
platform exec -T api pnpm ops smoke --url http://127.0.0.1:3000 | tee -a "${LOG}"

rto=$(( ( $(date +%s) - T0 ) / 60 ))
say "## done — RTO ${rto} min. Record it: RUNBOOK.md page 1 names the row (a *restore* audit_event and a backup_run row land with the signals task; until then this log is the record). Delete the age identity from this box now."
