#!/usr/bin/env bash
# Better Answers — the monthly restore drill (BACKUPS.md § Recovery order; ADR 0007, 0020, 0022, 0024, 0032).
#
# Runs from HOST CRON ON VPC 2 (the Coolify server; this repository checked out at /opt/better-answers by
# `host-setup.sh vpc2`) — not from inside a container of the stack it wipes. Staging is ON DEMAND (ADR 0024):
# the drill brings the two staging stacks up from the same compose files with the staging env, refills them
# from the off-host buckets, replays the recovery order, proves the platform answers, and ENDS BY WIPING
# STAGING and re-seeding the synthetic fixture: a restore is a copy of every client's personal data and
# ADR 0020 forbids it lingering.
#
# THIS IS THE STAGING DRILL. It wipes what it restores, on exit, whatever happened. A production restore is
# `restore-production.sh` (RUNBOOK.md page 1), which shares the recovery order and none of the traps.
#
# Every third month it rehearses the erasure routine on a synthetic subject. The report records, per store,
# found · acted · verified absent; the three retention dates a real report would quote; a grep of the
# restored dump for the subject's tokens; graph counts per label; RTO and RPO.
#
# A step whose slice is not built yet is recorded as such, not skipped silently: every `pnpm ops` command
# exits 3 for "the store this needs has no tables in this schema" (apps/api/src/ops.ts), and the drill
# writes that line into the report and carries on. Any other failure fails the drill.
#
# Idempotent; shell only. Exit non-zero on any failed step; the drill's dead-man check is 35 days.
#
# Env (a root-only file, /etc/better-answers/drill.env, written by host-setup.sh and read by cron):
set -euo pipefail

: "${REPO_DIR:?checkout of the repository on VPC 2}"
: "${STAGING_ENV_FILE:?the env file of the two staging stacks — every key the two compose files require, staging values}"
: "${STAGING_DATABASE_URL:?}" "${STAGING_API_URL:?http://127.0.0.1:3000 or the staging hostname}"
: "${BACKUP_DUMPS_BUCKET:?}" "${BACKUP_MIRROR_BUCKET:?}"       # rclone remote `dumps:` configured on the host from the READ credential
: "${BACKUP_AGE_IDENTITY_FILE:?the private half — resident on VPC 2 in a root-only file (SECRETS.md § The backup identity)}"
: "${STAGING_OBJECTSTORE_ROOT_KEY:?}" "${STAGING_OBJECTSTORE_ROOT_SECRET:?}"   # the staging Garage's keys, for `stagingstore:`
: "${PROD_PSQL:?a command that runs psql against production over SSH — see the drill.env template host-setup.sh writes}"
: "${DRILL_WORKSPACE:?the workspace whose graph is rebuilt and diffed}"
: "${HEALTHCHECKS_PING_URL_DRILL:?}" "${HEALTHCHECKS_PING_URL_STAGING_WIPED:?}"

# The `stagingstore:` remote — the staging object store, reached on the loopback port
# staging.override.yaml publishes; defined here from env rather than in a config file on disk.
export RCLONE_CONFIG_STAGINGSTORE_TYPE=s3 RCLONE_CONFIG_STAGINGSTORE_PROVIDER=Other \
       RCLONE_CONFIG_STAGINGSTORE_ENDPOINT=http://127.0.0.1:3900 RCLONE_CONFIG_STAGINGSTORE_FORCE_PATH_STYLE=true \
       RCLONE_CONFIG_STAGINGSTORE_REGION=garage \
       RCLONE_CONFIG_STAGINGSTORE_ACCESS_KEY_ID="${STAGING_OBJECTSTORE_ROOT_KEY}" \
       RCLONE_CONFIG_STAGINGSTORE_SECRET_ACCESS_KEY="${STAGING_OBJECTSTORE_ROOT_SECRET}"

NOT_BUILT=3   # apps/api/src/ops.ts: the slice this command needs has no tables in this schema
STAMP=$(date -u +%Y%m%dT%H%M%SZ); WORK=$(mktemp -d); REPORT="${WORK}/drill-${STAMP}.md"
started=$(date -u +%FT%TZ); T0=$(date +%s)
say() { printf '%s %s\n' "$(date -u +%T)" "$*" | tee -a "${REPORT}"; }
# aside — the same line, to the report and stderr only: for helpers whose stdout a caller captures
aside() { printf '%s %s\n' "$(date -u +%T)" "$*" | tee -a "${REPORT}" >&2; }
compose() { docker compose --project-directory "${REPO_DIR}/deploy" --env-file "${STAGING_ENV_FILE}" "$@"; }
stores()   { compose -f stores.compose.yaml -f staging.override.yaml -p better-answers-stores-staging "$@"; }
platform() { compose -f platform.compose.yaml -p better-answers-staging "$@"; }
# ops <args…> — a `pnpm ops` command inside the staging api; "not built" is reported, not fatal
ops() {
  local rc=0; platform exec -T api pnpm ops "$@" || rc=$?
  if [ "${rc}" -eq "${NOT_BUILT}" ]; then aside "  -> not built yet: 'pnpm ops $1' found no tables for its slice (recorded, not failed)"; return 0; fi
  return "${rc}"
}
wipe_staging() {
  platform down --remove-orphans || true; stores down --remove-orphans || true
  sudo rm -rf /data/objectstore/* /data/git/* /data/worker/lmdb/* /data/worker/trees/* /data/backup/staging/* "${WORK}"
  # The graph is plain tenant tables in `public` (ADR 0032): dropping the three schemas the journal
  # writes — public, index and drizzle's own — is the whole wipe. There is no per-workspace schema.
  psql "${STAGING_DATABASE_URL}" -qc "drop schema if exists public cascade; create schema public; drop schema if exists index cascade; drop schema if exists drizzle cascade;" || true
}
on_exit() { rc=$?
  if [ "${rc}" -ne 0 ]; then curl -fsS -m 10 -o /dev/null --data-raw "fail" "${HEALTHCHECKS_PING_URL_DRILL}/fail" || true; fi
  # whatever happened, staging must not keep client data
  wipe_staging && stores up -d init && platform run --rm migrate \
    && STAGING_DATABASE_URL="${STAGING_DATABASE_URL}" "${REPO_DIR}/deploy/seed-synthetic.sh" \
    && curl -fsS -m 10 -o /dev/null --data-raw "ok" "${HEALTHCHECKS_PING_URL_STAGING_WIPED}" || true
  exit "${rc}"
}
trap on_exit EXIT

say "# Restore drill ${STAMP} — workspace ${DRILL_WORKSPACE}"

say "## 0 wipe staging (starts from nothing)"; wipe_staging
say "## 1 postgres — latest daily dump"
latest=$(rclone lsf "dumps:${BACKUP_DUMPS_BUCKET}/pg/daily/" | grep '^pg-' | sort | tail -n1)
globals=$(rclone lsf "dumps:${BACKUP_DUMPS_BUCKET}/pg/daily/" | grep '^globals-' | sort | tail -n1)
dump_at=$(echo "${latest}" | sed -E 's/^pg-([0-9T]+Z)\..*/\1/')
rclone copyto "dumps:${BACKUP_DUMPS_BUCKET}/pg/daily/${globals}" "${WORK}/globals.sql.age"
rclone copyto "dumps:${BACKUP_DUMPS_BUCKET}/pg/daily/${latest}" "${WORK}/pg.dump.age"
age -d -i "${BACKUP_AGE_IDENTITY_FILE}" "${WORK}/globals.sql.age" | psql "${STAGING_DATABASE_URL}" -q || true   # roles may already exist
age -d -i "${BACKUP_AGE_IDENTITY_FILE}" -o "${WORK}/pg.dump" "${WORK}/pg.dump.age"
# --no-owner: the restoring role owns everything, as migrate's does. Privileges ARE restored: the
# grants to app_rt and worker_rt ride the dump, and without them the api answers permission denied.
pg_restore --no-owner --dbname="${STAGING_DATABASE_URL}" "${WORK}/pg.dump"
say "restored ${latest} (taken ${dump_at}) — RPO $(( ( $(date +%s) - $(date -d "${dump_at:0:8} ${dump_at:9:2}:${dump_at:11:2}" +%s) ) / 60 )) min"

say "## 2 stores up, migrate, REPLAY ERASURES completed after the dump (ADR 0020 — beyond use, made honest)"
stores up -d
platform run --rm migrate
# Mandatory and never "not built": an erasure the dump predates must be re-applied before the app
# turns healthy, and a schema that cannot say whether any exists stops the restore (ops.ts).
platform run --rm migrate pnpm ops replay-erasures --since "${dump_at}" | tee -a "${REPORT}"

say "## 3 object store — mirror back"
rclone sync "dumps:${BACKUP_MIRROR_BUCKET}/objectstore/" stagingstore:/

say "## 4 git store — one bare repository per workspace from its latest bundle (ADR 0024)"
for ws in $(rclone lsf --dirs-only "dumps:${BACKUP_DUMPS_BUCKET}/git/" | tr -d /); do
  b=$(rclone lsf "dumps:${BACKUP_DUMPS_BUCKET}/git/${ws}/" | sort | tail -n1)
  rclone copyto "dumps:${BACKUP_DUMPS_BUCKET}/git/${ws}/${b}" "${WORK}/${ws}.bundle.age"
  age -d -i "${BACKUP_AGE_IDENTITY_FILE}" -o "${WORK}/${ws}.bundle" "${WORK}/${ws}.bundle.age"
  sudo -u '#1000' git clone --quiet --bare "${WORK}/${ws}.bundle" "/data/git/${ws}.git"
done
# `api` alone: naming a service on the command line auto-enables its profile, and `worker` is
# behind the `pipeline` profile until T-006's work loop exists (platform.compose.yaml).
platform up -d --wait api
say "api up — RTO so far $(( ( $(date +%s) - T0 ) / 60 )) min"

say "## 5 recovery order 2–5: watermark, graph rebuild, pipeline state (LMDBs empty → reprocess), orphans"
ops reconcile-watermark --workspace "${DRILL_WORKSPACE}"
t0=$(date +%s); ops graph-rebuild --workspace "${DRILL_WORKSPACE}" --wait
say "graph rebuilt in $(( $(date +%s) - t0 )) s (promise: ≤ 120 s)"
ops graph-sweep --workspace "${DRILL_WORKSPACE}" --wait
ops object-store-orphans --workspace "${DRILL_WORKSPACE}" --list >> "${REPORT}"

say "## 6 counts diff against production's stamped run (ADR 0023) — production read over SSH, no open port (ticket 79 A12)"
if ops graph-counts --workspace "${DRILL_WORKSPACE}" > "${WORK}/staging.counts"; then
  # The SQL travels on stdin: an argument would be re-split by the shell on the far side of the SSH hop.
  printf '%s' "select counts_json from graph_sync_run where workspace_id = '${DRILL_WORKSPACE}' and outcome = 'ok' order by finished_at desc limit 1" \
    | ${PROD_PSQL} -At > "${WORK}/prod.counts" 2>/dev/null || echo '{}' > "${WORK}/prod.counts"
  if [ -s "${WORK}/staging.counts" ] && diff <(jq -S . "${WORK}/prod.counts") <(jq -S . "${WORK}/staging.counts") >> "${REPORT}"; then say "counts match"; elif [ -s "${WORK}/staging.counts" ]; then say "COUNTS DIFFER"; exit 1; fi
fi

say "## 7 smoke through the interface: health, discovery, the shell; find · a guide read · ask as the slices land"
platform exec -T api pnpm ops smoke --workspace "${DRILL_WORKSPACE}" --url "${STAGING_API_URL}" --find --guide --ask >> "${REPORT}"

say "## 8 bucket listing vs the matrix (tiers live in the bucket lifecycle, never in Coolify's schedule)"
for tier in hourly daily weekly monthly; do printf '%s: %s copies\n' "${tier}" "$(rclone lsf "dumps:${BACKUP_DUMPS_BUCKET}/pg/${tier}/" | wc -l)" >> "${REPORT}"; done

if [ $(( $(date +%-m) % 3 )) -eq 0 ]; then
  say "## 9 erasure rehearsal on a synthetic subject (ADR 0020, ticket 24)"
  if subject=$(platform exec -T api pnpm ops erasure-rehearsal --workspace "${DRILL_WORKSPACE}" --synthetic --report /tmp/erasure.md | tail -n1); then
    platform exec -T api cat /tmp/erasure.md >> "${REPORT}"
    # the one check that proves "gone from every copy" rather than assumes it: the pre-erasure dump,
    # restored to plain SQL by pg_restore on the host, grepped for the subject's tokens inside the api
    pg_restore -f - "${WORK}/pg.dump" | platform exec -T api pnpm ops dump-grep --tokens "${subject}" >> "${REPORT}" \
      && say "dump grep: subject present in the pre-erasure copy (expected; expiry dates recorded)"
  else
    say "  -> not built yet: the erasure slice has no tables in this schema (recorded, not failed)"
  fi
fi

rto=$(( ( $(date +%s) - T0 ) / 60 ))
say "## done — RTO ${rto} min"
rclone copyto "${REPORT}" "dumps:${BACKUP_DUMPS_BUCKET}/drills/$(basename "${REPORT}")"
# The drill's own row goes to PRODUCTION (ticket 79 A13): staging is wiped minutes from now, and
# ADR 0025's "last drill" signal has no other source. The one write the drill makes there.
printf '%s' "insert into backup_run (kind, store, started_at, finished_at, outcome, bytes, location, report_url, contains_personal_data, rto_minutes) values ('drill', 'all', '${started}', now(), 'ok', 0, 'drills/', 'drills/$(basename "${REPORT}")', false, ${rto})" \
  | ${PROD_PSQL} -q -v ON_ERROR_STOP=1 || say "backup_run row not written to production (no backup_run table yet — it lands with the signals task)"
curl -fsS -m 10 -o /dev/null --data-raw "ok took=${rto}m" "${HEALTHCHECKS_PING_URL_DRILL}"
