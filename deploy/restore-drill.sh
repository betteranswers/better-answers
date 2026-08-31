#!/usr/bin/env bash
# Better Answers — the monthly restore drill (deploy/BACKUPS.md § Recovery order; ADR 0007, 0020, 0021, 0024).
#
# Runs from HOST CRON ON VPC 2 (the Coolify server; this repository checked out there by the wizard) —
# not from inside a container of the stack it wipes. Staging is ON DEMAND (ADR 0024): the drill brings the two
# staging stacks up from the same compose files with the staging env, refills them from the off-host buckets, replays the recovery
# order, proves the platform answers, and ENDS BY WIPING STAGING and re-seeding the synthetic fixture:
# a restore is a copy of every client's personal data and ADR 0020 forbids it lingering.
#
# Every third month it rehearses the erasure routine on a synthetic subject. The report records, per
# store, found · acted · verified absent; the three retention dates a real report would quote; a grep of
# the restored dump for the subject's tokens; graph counts per label; RTO and RPO.
#
# Idempotent; shell only. Exit non-zero on any failed step; the drill's dead-man check is 35 days.
set -euo pipefail

: "${REPO_DIR:?checkout of the repository on VPC 2}"
: "${STAGING_DATABASE_URL:?}" "${STAGING_API_URL:?http://127.0.0.1:3000 or the staging hostname}"
: "${BACKUP_DUMPS_BUCKET:?}" "${BACKUP_MIRROR_BUCKET:?}"       # rclone remote `dumps:` configured on the host from the READ credential
: "${BACKUP_AGE_IDENTITY_FILE:?the private half — on VPC 2 only for the drill, read from the escrow item}"
: "${PROD_DATABASE_URL_RO:?read-only DSN to production, for the graph counts diff}"
: "${DRILL_WORKSPACE:?the workspace whose graph is rebuilt and diffed}"
: "${HEALTHCHECKS_PING_URL_DRILL:?}" "${HEALTHCHECKS_PING_URL_STAGING_WIPED:?}"

STAMP=$(date -u +%Y%m%dT%H%M%SZ); WORK=$(mktemp -d); REPORT="${WORK}/drill-${STAMP}.md"
started=$(date -u +%FT%TZ); T0=$(date +%s)
say() { printf '%s %s\n' "$(date -u +%T)" "$*" | tee -a "${REPORT}"; }
stores() { docker compose --project-directory "${REPO_DIR}/deploy" -f stores.compose.yaml -p better-answers-stores-staging "$@"; }
platform() { docker compose --project-directory "${REPO_DIR}/deploy" -f platform.compose.yaml -p better-answers-staging "$@"; }
wipe_staging() {
  platform down --remove-orphans || true; stores down --remove-orphans || true
  sudo rm -rf /data/objectstore/* /data/git/* /data/worker/lmdb/* /data/worker/trees/* /data/backup/staging/* "${WORK}"
  psql "${STAGING_DATABASE_URL}" -qc "drop schema if exists public cascade; create schema public; drop schema if exists index cascade;" || true
}
on_exit() { rc=$?
  if [ "${rc}" -ne 0 ]; then curl -fsS -m 10 -o /dev/null --data-raw "fail" "${HEALTHCHECKS_PING_URL_DRILL}/fail" || true; fi
  # whatever happened, staging must not keep client data
  wipe_staging && stores up -d init && "${REPO_DIR}/deploy/seed-synthetic.sh" && curl -fsS -m 10 -o /dev/null --data-raw "ok" "${HEALTHCHECKS_PING_URL_STAGING_WIPED}" || true
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
pg_restore --no-owner --no-privileges --dbname="${STAGING_DATABASE_URL}" "${WORK}/pg.dump"
say "restored ${latest} (taken ${dump_at}) — RPO $(( ( $(date +%s) - $(date -d "${dump_at:0:8} ${dump_at:9:2}:${dump_at:11:2}" +%s) ) / 60 )) min"

say "## 2 stores up, migrate, REPLAY ERASURES completed after the dump (ADR 0020 — beyond use, made honest)"
stores up -d
platform run --rm migrate
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
platform up -d api worker
say "api and worker up — RTO so far $(( ( $(date +%s) - T0 ) / 60 )) min"

say "## 5 recovery order 2–5: watermark, graph rebuild, pipeline state (LMDBs empty → reprocess), orphans"
platform exec -T api pnpm ops reconcile-watermark --workspace "${DRILL_WORKSPACE}"
t0=$(date +%s); platform exec -T api pnpm ops graph-rebuild --workspace "${DRILL_WORKSPACE}" --wait
say "graph rebuilt in $(( $(date +%s) - t0 )) s (promise: ≤ 120 s)"
platform exec -T api pnpm ops graph-sweep --workspace "${DRILL_WORKSPACE}" --wait
platform exec -T api pnpm ops object-store-orphans --workspace "${DRILL_WORKSPACE}" --list >> "${REPORT}"

say "## 6 counts diff against production's stamped run (ADR 0023)"
platform exec -T api pnpm ops graph-counts --workspace "${DRILL_WORKSPACE}" > "${WORK}/staging.counts"
psql "${PROD_DATABASE_URL_RO}" -At -c "select counts_json from graph_sync_run where workspace_id = '${DRILL_WORKSPACE}' and outcome = 'ok' order by finished_at desc limit 1" > "${WORK}/prod.counts"
if diff <(jq -S . "${WORK}/prod.counts") <(jq -S . "${WORK}/staging.counts") >> "${REPORT}"; then say "counts match"; else say "COUNTS DIFFER"; exit 1; fi

say "## 7 smoke through the interface: find · a guide read · ask"
platform exec -T api pnpm ops smoke --workspace "${DRILL_WORKSPACE}" --find --guide --ask >> "${REPORT}"

say "## 8 bucket listing vs the matrix (tiers live in the bucket lifecycle, never in Coolify's schedule)"
for tier in hourly daily weekly monthly; do printf '%s: %s copies\n' "${tier}" "$(rclone lsf "dumps:${BACKUP_DUMPS_BUCKET}/pg/${tier}/" | wc -l)" >> "${REPORT}"; done

if [ $(( $(date +%-m) % 3 )) -eq 0 ]; then
  say "## 9 erasure rehearsal on a synthetic subject (ADR 0020, ticket 24)"
  subject=$(platform exec -T api pnpm ops erasure-rehearsal --workspace "${DRILL_WORKSPACE}" --synthetic --report "${WORK}/erasure.md" | tail -n1)
  cat "${WORK}/erasure.md" >> "${REPORT}"
  # the one check that proves "gone from every copy" rather than assumes it
  platform exec -T api pnpm ops dump-grep --tokens "${subject}" < "${WORK}/pg.dump" >> "${REPORT}" && say "dump grep: subject present in the pre-erasure copy (expected; expiry dates recorded)"
fi

rto=$(( ( $(date +%s) - T0 ) / 60 ))
say "## done — RTO ${rto} min"
rclone copyto "${REPORT}" "dumps:${BACKUP_DUMPS_BUCKET}/drills/$(basename "${REPORT}")"
psql "${STAGING_DATABASE_URL}" -qc "insert into backup_run (kind, store, started_at, finished_at, outcome, bytes, location, report_url, contains_personal_data, rto_minutes) values ('drill', 'all', '${started}', now(), 'ok', 0, 'drills/', 'drills/$(basename "${REPORT}")', false, ${rto})" || true
psql "${PROD_DATABASE_URL_RO%%\?*}" -qc "select 1" >/dev/null 2>&1 || true   # production is never written by the drill
curl -fsS -m 10 -o /dev/null --data-raw "ok took=${rto}m" "${HEALTHCHECKS_PING_URL_DRILL}"
