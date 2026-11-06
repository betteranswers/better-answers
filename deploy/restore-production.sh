#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?set it to the production owner DSN}" "${REPO_DIR:?}" "${PLATFORM_ENV_FILE:?}" "${STORES_ENV_FILE:?}"
: "${BACKUP_DUMPS_BUCKET:?}" "${BACKUP_MIRROR_BUCKET:?}" "${BACKUP_AGE_IDENTITY_FILE:?set it to the age identity file from escrow, kept on this box only for this restore}"
[ -s "${BACKUP_AGE_IDENTITY_FILE}" ] || { echo "BACKUP_AGE_IDENTITY_FILE (${BACKUP_AGE_IDENTITY_FILE}) is empty or missing. Copy the age identity from escrow into it." >&2; exit 1; }
[ -s "${REPO_DIR}/deploy/empty-database.sql" ] || { echo "${REPO_DIR}/deploy/empty-database.sql is missing or empty. Set REPO_DIR to a current checkout of the repository." >&2; exit 1; }

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

# The api writes /data/git as this uid; the stores stack's init service makes it the store's owner.
API_UID=1000
WORK=$(mktemp -d); chmod 700 "${WORK}"; BUNDLES=$(mktemp -d); started=$(date -u +%FT%TZ); T0=$(date +%s); LOG="/var/log/better-answers-restore-$(date -u +%Y%m%dT%H%M%SZ).log"
say() { printf '%s %s\n' "$(date -u +%T)" "$*" | tee -a "${LOG}"; }
compose() { docker compose --project-directory "${REPO_DIR}/deploy" "$@"; }
stores()   { compose --env-file "${STORES_ENV_FILE}" -f stores.compose.yaml -p better-answers-stores "$@"; }
platform() { compose --env-file "${PLATFORM_ENV_FILE}" -f platform.compose.yaml -p better-answers "$@"; }
tool() { stores run --rm --no-deps -v "${WORK}:/work" -v "${BACKUP_AGE_IDENTITY_FILE}:/run/age.key:ro" backup "$@"; }
rclone() { tool rclone "$@"; }
cleanup_work() { rm -rf "${WORK}" "${BUNDLES}"; }   # the decrypted dump and bundles are personal data

# No exit trap: the drill wipes staging on exit, but this script runs on production and must not wipe it.

say "# Production restore: dump=${dump} tier=${tier} objectstore=${objectstore} git=${git}"
say "work directories: ${WORK} and ${BUNDLES}. They hold the decrypted dump and bundles; if the run stops early, delete them by hand."

say "## 0 Choose the dump"
if [ "${dump}" = latest ]; then
  dump=$(rclone lsf "dumps:${BACKUP_DUMPS_BUCKET}/pg/${tier}/" | grep '^pg-' | sort | tail -n1)
fi
[ -n "${dump}" ] || { say "no dump found under pg/${tier}/"; exit 1; }
stamp=$(echo "${dump}" | sed -E 's/^pg-([0-9T]+Z)\..*/\1/')
globals=$(rclone lsf "dumps:${BACKUP_DUMPS_BUCKET}/pg/${tier}/" | grep "^globals-${stamp}" | head -n1)
say "restoring ${dump}, taken ${stamp}. Every write since then is lost, and every erasure since then is replayed."
if [ "${yes}" != yes ]; then printf 'Type the dump timestamp (%s) to continue: ' "${stamp}"; read -r typed; [ "${typed}" = "${stamp}" ] || { say "aborted"; exit 1; }; fi

say "## 1 Stop the backup service and api, so that no dump runs and nothing writes while the stores are replaced. The rest of the stores stack stays up."
# A dump's locks would hold up the one transaction below, and a nightly run would sync a half-restored object store over its mirror.
stores stop backup
platform stop api || true

say "## 2 Restore Postgres: read the whole dump before changing anything, then empty and restore the database in one transaction"
rclone copyto "dumps:${BACKUP_DUMPS_BUCKET}/pg/${tier}/${dump}" "/work/pg.dump.age"
[ -z "${globals}" ] || rclone copyto "dumps:${BACKUP_DUMPS_BUCKET}/pg/${tier}/${globals}" "/work/globals.sql.age"
tool age -d -i /run/age.key -o /work/pg.dump /work/pg.dump.age
# >>> replace the database
# A dump that cannot be read in full stops here, before anything is dropped. --no-owner: the restoring role owns every object; the dump carries the grants.
tool pg_restore --no-owner --file=/work/pg.sql /work/pg.dump \
  || { say "REFUSED: ${dump} cannot be read in full. The database is unchanged."; exit 1; }
# shellcheck disable=SC2016 # the tool container's shell expands it, where DATABASE_URL is set
[ ! -f "${WORK}/globals.sql.age" ] || tool sh -c 'age -d -i /run/age.key /work/globals.sql.age | psql "$DATABASE_URL" -q' || true
# Emptied, not --clean: --clean cannot drop a partition's inherited key, keeps what the dump lacks, and recreates tables under the live default grants.
cp "${REPO_DIR}/deploy/empty-database.sql" "${WORK}/empty.sql"
# One transaction: a statement that fails leaves the database as it was, and no reader sees it half replaced.
# shellcheck disable=SC2016 # the tool container's shell expands it, where DATABASE_URL is set
tool sh -c 'psql "$DATABASE_URL" -X -q -o /dev/null --single-transaction -v ON_ERROR_STOP=1 -f /work/empty.sql -f /work/pg.sql'
# <<< replace the database
rm -f "${WORK}/pg.dump" "${WORK}/pg.sql" "${WORK}/empty.sql" "${WORK}/pg.dump.age" "${WORK}/globals.sql.age"
say "restored. RPO: $(( ( $(date +%s) - $(date -d "${stamp:0:8} ${stamp:9:2}:${stamp:11:2}" +%s) ) / 60 )) min"

say "## 3 Migrate the restored schema to the current version"
platform run --rm migrate

if [ "${objectstore}" = yes ]; then
  say "## 4 Restore the object store from the mirror bucket. Objects deleted there were erased, and stay deleted."
  stores run --rm --no-deps backup rclone sync "dumps:${BACKUP_MIRROR_BUCKET}/objectstore/" src:/
fi

if [ "${git}" = yes ]; then
  say "## 5 Restore the git store: one bare repository per workspace from its latest bundle"
  if [ -n "$(ls -A /data/git 2>/dev/null)" ]; then say "REFUSED: /data/git is not empty, and its repositories are newer than any bundle. Clone them from the VPC 2 mirror instead, or empty /data/git yourself first."; exit 1; fi
  # >>> the git store
  # Git runs as the api's uid so that root owns no file in the store. That uid cannot enter WORK, which holds the decrypted dump.
  chown "${API_UID}:${API_UID}" "${BUNDLES}"
  # List before the loop: `for` ignores a failed listing, and the init below would then leave every workspace empty.
  bundled=$(rclone lsf --dirs-only "dumps:${BACKUP_DUMPS_BUCKET}/git/" | tr -d '/\r')
  for ws in ${bundled}; do
    b=$(rclone lsf "dumps:${BACKUP_DUMPS_BUCKET}/git/${ws}/" | sort | tail -n1 | tr -d '\r')
    rclone copyto "dumps:${BACKUP_DUMPS_BUCKET}/git/${ws}/${b}" "/work/${ws}.bundle.age"
    tool age -d -i /run/age.key -o "/work/${ws}.bundle" "/work/${ws}.bundle.age"
    # Move, never copy, so the plaintext is in only one directory at a time.
    mv "${WORK}/${ws}.bundle" "${BUNDLES}/${ws}.bundle"
    chown "${API_UID}:${API_UID}" "${BUNDLES}/${ws}.bundle"
    rm -f "${WORK}/${ws}.bundle.age"
    sudo -u "#${API_UID}" git clone --quiet --bare "${BUNDLES}/${ws}.bundle" "/data/git/${ws}.git"
    rm -f "${BUNDLES}/${ws}.bundle"
  done
  # The nightly job bundles no repository without a ref, so a workspace with no writes yet has no bundle.
  # shellcheck disable=SC2016 # the tool container's shell expands it, where DATABASE_URL is set
  workspaces=$(tool sh -c 'psql "$DATABASE_URL" -X -At -c "select id from workspace"' | tr -d '\r')
  for ws in ${workspaces}; do
    [ -d "/data/git/${ws}.git" ] || sudo -u "#${API_UID}" git init --quiet --bare --initial-branch main "/data/git/${ws}.git"
  done
  # <<< the git store
fi
cleanup_work

say "## 6 Replay the erasures completed after ${stamp}. This step is mandatory; if it fails, api and the backup service stay stopped."
# Runs in api, not migrate: only api mounts the git directory and object store that the replay reads.
platform run --rm --no-deps api node apps/api/src/environment-gate.ts ops replay-erasures --since "${stamp}" | tee -a "${LOG}"

say "## 7 Start api and smoke test it"
platform up -d --wait api
platform exec -T api pnpm ops smoke --url http://127.0.0.1:3000 | tee -a "${LOG}"

say "## 8 Start the backup service. Its next hourly run dumps the restored database."
stores start backup

rto=$(( ( $(date +%s) - T0 ) / 60 ))
# >>> record the restore
finished=$(date -u +%FT%TZ)
restored="('restore', 'postgres', '${started}', '${finished}', 'ok', 'pg/${tier}/${dump}', false, ${rto})"
[ "${objectstore}" != yes ] || restored+=", ('restore', 'objectstore', '${started}', '${finished}', 'ok', 'objectstore/', false, ${rto})"
[ "${git}" != yes ] || restored+=", ('restore', 'git', '${started}', '${finished}', 'ok', 'git/', false, ${rto})"
row="insert into backup (kind, store, started_at, finished_at, outcome, location, contains_personal_data, rto_minutes) values ${restored} on conflict do nothing"
# shellcheck disable=SC2016 # the tool container's shell expands it, where DATABASE_URL is set
if ! stores run --rm --no-deps backup sh -c 'psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -c "$1"' sh "${row}"; then
  say "backup row not written. When the database answers, run: ${row}"
fi
# <<< record the restore
say "## Done. RTO: ${rto} min. No *restore* audit_event is written yet, so this log is the record of the restore. Delete the age identity from this box now."
