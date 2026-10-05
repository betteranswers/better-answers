#!/usr/bin/env bash
set -euo pipefail

: "${REPO_DIR:?checkout of the repository on VPC 2}"
: "${STAGING_ENV_FILE:?the env file of the two staging stacks — every key the two compose files require, staging values}"
: "${STAGING_DATABASE_URL:?}" "${STAGING_API_URL:?http://127.0.0.1:3000 or the staging hostname}"
: "${BACKUP_DUMPS_BUCKET:?}" "${BACKUP_MIRROR_BUCKET:?}"
: "${BACKUP_AGE_IDENTITY_FILE:?the private half — resident on VPC 2 in a root-only file (SECRETS.md § The backup identity)}"
: "${STAGING_OBJECTSTORE_ROOT_KEY:?}" "${STAGING_OBJECTSTORE_ROOT_SECRET:?}"
: "${STAGING_S3_BUCKET:=better-answers}"
: "${PROD_PSQL:?a command that runs psql against production over SSH — see the drill.env template host-setup.sh writes}"
: "${DRILL_WORKSPACE:?the workspace whose map is rebuilt and diffed}"
: "${HEALTHCHECKS_PING_URL_DRILL:?}" "${HEALTHCHECKS_PING_URL_STAGING_WIPED:?}"
: "${RCLONE_CONFIG_DRILLSINK_ACCESS_KEY_ID:?the WRITE-AND-LIST credential — the report upload alone}"

export RCLONE_CONFIG_STAGINGSTORE_TYPE=s3 RCLONE_CONFIG_STAGINGSTORE_PROVIDER=Other \
       RCLONE_CONFIG_STAGINGSTORE_ENDPOINT=http://127.0.0.1:3900 RCLONE_CONFIG_STAGINGSTORE_FORCE_PATH_STYLE=true \
       RCLONE_CONFIG_STAGINGSTORE_REGION=garage \
       RCLONE_CONFIG_STAGINGSTORE_ACCESS_KEY_ID="${STAGING_OBJECTSTORE_ROOT_KEY}" \
       RCLONE_CONFIG_STAGINGSTORE_SECRET_ACCESS_KEY="${STAGING_OBJECTSTORE_ROOT_SECRET}"

NOT_BUILT=3
# The uid the api writes /data/git as: the stores stack's init hands the store to it.
API_UID=1000
STAMP=$(date -u +%Y%m%dT%H%M%SZ); WORK=$(mktemp -d); BUNDLES=$(mktemp -d); REPORT="${WORK}/drill-${STAMP}.md"
started=$(date -u +%FT%TZ); T0=$(date +%s)
say() { printf '%s %s\n' "$(date -u +%T)" "$*" | tee -a "${REPORT}"; }
aside() { printf '%s %s\n' "$(date -u +%T)" "$*" | tee -a "${REPORT}" >&2; }
# >>> the staging projects
DEPLOY_DIR="${REPO_DIR}/deploy"
# The -f paths are absolute: compose resolves them against the caller's cwd.
compose() { docker compose --project-directory "${DEPLOY_DIR}" --env-file "${STAGING_ENV_FILE}" "$@"; }
stores()   { compose -f "${DEPLOY_DIR}/stores.compose.yaml" -f "${DEPLOY_DIR}/staging.override.yaml" -p better-answers-stores-staging "$@"; }
platform() { compose -f "${DEPLOY_DIR}/platform.compose.yaml" -f "${DEPLOY_DIR}/staging.platform.override.yaml" -p better-answers-staging "$@"; }
# Both overrides name it external, and compose refuses to start a service on one that does not exist.
STAGING_NETWORK=better-answers-staging-shared
# --internal: a plain bridge sorts first by name, so it would carry every member's default route in place of its project's network.
ensure_staging_network() {
  docker network inspect "${STAGING_NETWORK}" >/dev/null 2>&1 || docker network create --internal "${STAGING_NETWORK}" >/dev/null
}
# <<< the staging projects
# >>> the drill's commands
ops() {
  local rc=0; platform exec -T api pnpm --silent ops "$@" || rc=$?
  # A command's tables come from the schema, so "not built" after migrate means the restored copy lost one.
  if [ "${rc}" -eq "${NOT_BUILT}" ]; then aside "DRILL FAILED: 'pnpm ops $1' answered not built, so a table its slice needs is absent from the restored copy"; fi
  return "${rc}"
}
# <<< the drill's commands
wipe_staging() {
  # Not "${WORK}": step 0 wipes too, and the report being written lives there.
  platform down --remove-orphans || true; stores down --remove-orphans || true
  sudo rm -rf /data/objectstore/* /data/git/* /data/worker/lmdb/* /data/worker/trees/* /data/backup/staging/*
  # >>> empty the database
  # The file the production restore empties production with, so `public` and its grants come back as they do there.
  psql "${STAGING_DATABASE_URL}" -X -q -v ON_ERROR_STOP=1 -f "${DEPLOY_DIR}/empty-database.sql"
  # <<< empty the database
}
on_exit() { rc=$?
  if [ "${rc}" -ne 0 ]; then curl -fsS -m 10 -o /dev/null --data-raw "fail" "${HEALTHCHECKS_PING_URL_DRILL}/fail" || true; fi
  wipe_staging && stores up -d init && platform run --rm migrate \
    && STAGING_DATABASE_URL="${STAGING_DATABASE_URL}" "${REPO_DIR}/deploy/seed-synthetic.sh" \
    && curl -fsS -m 10 -o /dev/null --data-raw "ok" "${HEALTHCHECKS_PING_URL_STAGING_WIPED}" || true
  sudo rm -rf "${WORK}" "${BUNDLES}"
  exit "${rc}"
}
trap on_exit EXIT

say "# Restore drill ${STAMP} — workspace ${DRILL_WORKSPACE}"
# >>> workspace id
synthetic_workspace=$("${DEPLOY_DIR}/seed-synthetic.sh" --workspace-id)
# Every ops command refuses a workspace id that is not a ULID, and the first reads it half an hour in.
if ! [[ "${DRILL_WORKSPACE}" =~ ^[0-9A-HJKMNP-TV-Z]{26}$ ]]; then
  say "REFUSED: DRILL_WORKSPACE ${DRILL_WORKSPACE} is not a workspace id; the synthetic fixture's is ${synthetic_workspace}"; exit 1
fi
# <<< workspace id

say "## 0 wipe staging (starts from nothing)"; ensure_staging_network; wipe_staging
say "## 1 postgres — the newest dump in any tier"
# >>> the newest dump
# The 02:05 dump is filed weekly on a Sunday and monthly on the 1st, the drill's day.
dumps=""
for t in hourly daily weekly monthly; do
  dumps+=$(rclone lsf "dumps:${BACKUP_DUMPS_BUCKET}/pg/${t}/" | { grep '^pg-' || true; } | sed "s|\$| ${t}|")$'\n'
done
read -r latest tier <<<"$(printf '%s' "${dumps}" | sort | tail -n1)"
dump_at=$(echo "${latest}" | sed -E 's/^pg-([0-9T]+Z)\..*/\1/')
globals="globals-${dump_at}.sql.age"
# <<< the newest dump
rclone copyto "dumps:${BACKUP_DUMPS_BUCKET}/pg/${tier}/${globals}" "${WORK}/globals.sql.age"
rclone copyto "dumps:${BACKUP_DUMPS_BUCKET}/pg/${tier}/${latest}" "${WORK}/pg.dump.age"
# Production's globals carry an ALTER ROLE that would reset the staging superuser's password.
staging_owner=$(printf '%s' "${STAGING_DATABASE_URL}" | sed -E 's|^[a-z]+://([^:/@]+).*|\1|')
age -d -i "${BACKUP_AGE_IDENTITY_FILE}" "${WORK}/globals.sql.age" | grep -v -E "^(CREATE|ALTER) ROLE \"?${staging_owner}\"?[ ;]" | psql "${STAGING_DATABASE_URL}" -q || true
age -d -i "${BACKUP_AGE_IDENTITY_FILE}" -o "${WORK}/pg.dump" "${WORK}/pg.dump.age"
# >>> restore the database
# --no-owner: the restoring role owns everything; the grants still ride the dump.
pg_restore --no-owner --dbname="${STAGING_DATABASE_URL}" "${WORK}/pg.dump"
# <<< restore the database
say "restored ${latest} (taken ${dump_at}) — RPO $(( ( $(date +%s) - $(date -d "${dump_at:0:8} ${dump_at:9:2}:${dump_at:11:2}" +%s) ) / 60 )) min"

say "## 2 stores up, the staging Garage keyed and its bucket made, migrate"
stores up -d
stores exec -T objectstore /garage key import --yes -n drill-root \
  "${STAGING_OBJECTSTORE_ROOT_KEY}" "${STAGING_OBJECTSTORE_ROOT_SECRET}" || true
stores exec -T objectstore /garage key allow --create-bucket "${STAGING_OBJECTSTORE_ROOT_KEY}"
stores exec -T objectstore /garage bucket create "${STAGING_S3_BUCKET}" || true
stores exec -T objectstore /garage bucket allow --read --write "${STAGING_S3_BUCKET}" --key "${STAGING_OBJECTSTORE_ROOT_KEY}"
platform run --rm migrate

say "## 3 object store — mirror back"
rclone sync "dumps:${BACKUP_MIRROR_BUCKET}/objectstore/" stagingstore:/

say "## 4 git store — one bare repository per workspace from its latest bundle (ADR 0024)"
# >>> the git store
# The api's uid runs git, so the store holds no file of root's. It cannot enter WORK, which holds the decrypted dump.
chown "${API_UID}:${API_UID}" "${BUNDLES}"
# Read before the loop: `for` ignores a failed listing, and the init below would leave every workspace empty.
bundled=$(rclone lsf --dirs-only "dumps:${BACKUP_DUMPS_BUCKET}/git/" | tr -d /)
for ws in ${bundled}; do
  b=$(rclone lsf "dumps:${BACKUP_DUMPS_BUCKET}/git/${ws}/" | sort | tail -n1)
  rclone copyto "dumps:${BACKUP_DUMPS_BUCKET}/git/${ws}/${b}" "${WORK}/${ws}.bundle.age"
  age -d -i "${BACKUP_AGE_IDENTITY_FILE}" -o "${BUNDLES}/${ws}.bundle" "${WORK}/${ws}.bundle.age"
  chown "${API_UID}:${API_UID}" "${BUNDLES}/${ws}.bundle"
  sudo -u "#${API_UID}" git clone --quiet --bare "${BUNDLES}/${ws}.bundle" "/data/git/${ws}.git"
  rm -f "${BUNDLES}/${ws}.bundle"
done
# The nightly bundles no repository without a ref, so a workspace not yet written to has none.
workspaces=$(psql "${STAGING_DATABASE_URL}" -X -At -c 'select id from workspace')
for ws in ${workspaces}; do
  [ -d "/data/git/${ws}.git" ] || sudo -u "#${API_UID}" git init --quiet --bare --initial-branch main "/data/git/${ws}.git"
done
# <<< the git store

say "## 5 REPLAY ERASURES completed after the dump (ADR 0020 — beyond use, made honest)"
platform run --rm --no-deps api pnpm --silent ops replay-erasures --since "${dump_at}" | tee -a "${REPORT}"

say "## 5b the synthetic fixture joins the restored copy: its workspace's rows, chunk partition and an empty repository"
# No production dump holds it, and it is the one workspace the drill may always rebuild, seed a subject into and erase.
STAGING_DATABASE_URL="${STAGING_DATABASE_URL}" "${DEPLOY_DIR}/seed-synthetic.sh" | tee -a "${REPORT}"
[ -d "/data/git/${synthetic_workspace}.git" ] || sudo -u "#${API_UID}" git init --quiet --bare --initial-branch main "/data/git/${synthetic_workspace}.git"

platform up -d --wait api worker
say "api up — RTO so far $(( ( $(date +%s) - T0 ) / 60 )) min"

say "## 6 recovery order 2–5: watermark, map rebuild, pipeline state (LMDBs empty → reprocess), orphans"
ops reconcile-watermark --workspace "${DRILL_WORKSPACE}"
t0=$(date +%s); ops map-rebuild --workspace "${DRILL_WORKSPACE}" --wait
say "map rebuilt in $(( $(date +%s) - t0 )) s (promise: ≤ 120 s)"
ops map-sweep --workspace "${DRILL_WORKSPACE}"
ops object-store-orphans --workspace "${DRILL_WORKSPACE}" >> "${REPORT}"

say "## 7 counts of the rebuilt map for this workspace"
# >>> the counts
ops map-counts --workspace "${DRILL_WORKSPACE}" > "${WORK}/staging.counts"
if [ ! -s "${WORK}/staging.counts" ]; then say "DRILL FAILED: map-counts printed no counts for ${DRILL_WORKSPACE}"; exit 1; fi
cat "${WORK}/staging.counts" >> "${REPORT}"
# A live map moves on after the dump, so only a recorded run is a fair comparison, and production records none yet.
say "production records no run of the map's counts: staging counts recorded, not compared"
# <<< the counts

say "## 8 smoke through the interface: health, discovery, the shell; find · a guide read · ask as the slices land"
platform exec -T api pnpm --silent ops smoke --workspace "${DRILL_WORKSPACE}" --url "${STAGING_API_URL}" --find --guide --ask >> "${REPORT}"

say "## 9 bucket listing vs the matrix (tiers live in the bucket lifecycle, never in Coolify's schedule)"
for tier in hourly daily weekly monthly; do printf '%s: %s copies\n' "${tier}" "$(rclone lsf "dumps:${BACKUP_DUMPS_BUCKET}/pg/${tier}/" | wc -l)" >> "${REPORT}"; done

if [ $(( $(date +%-m) % 3 )) -eq 0 ]; then
  say "## 10 erasure rehearsal on a synthetic subject — the proof that an erasure erases (ADR 0020, 0022; ticket 24)"
  ws_repo="/data/git/${DRILL_WORKSPACE}.git"
  ws_git() { sudo -u "#${API_UID}" git -C "${ws_repo}" "$@"; }
  commits_before_seed=$({ ws_git rev-list --all 2>/dev/null || true; } | sort)

  # A fence: the deploy tree's suite lifts the lines between the markers and runs them.
  # >>> seed status
  seed_rc=0
  # The seed's index job queues behind whatever the restore left for the drill workspace.
  subject=$(platform exec -T api pnpm --silent ops erasure-rehearsal --workspace "${DRILL_WORKSPACE}" --synthetic --seed --wait-seconds 600 | tail -n1) || seed_rc=$?
  if [ "${seed_rc}" -eq "${NOT_BUILT}" ]; then
    say "REHEARSAL FAILED: the synthetic seed answered not built, so a table the erasure slice needs is absent from the restored copy"; exit 1
  fi
  if [ "${seed_rc}" -ne 0 ]; then
    say "REHEARSAL FAILED: the synthetic seed exited ${seed_rc}"; exit 1
  fi
  # <<< seed status
  commits_after_seed=$({ ws_git rev-list --all 2>/dev/null || true; } | sort)
  seeded_commits=$(comm -13 <(printf '%s\n' "${commits_before_seed}") <(printf '%s\n' "${commits_after_seed}"))

  pg_dump --format=plain --dbname="${STAGING_DATABASE_URL}" > "${WORK}/pre-erasure.sql"

  platform exec -T api pnpm --silent ops dump-grep --tokens "${subject}" < "${WORK}/pre-erasure.sql" > "${WORK}/pre-erasure.grep"
  cat "${WORK}/pre-erasure.grep" >> "${REPORT}"
  # >>> found before
  if ! grep -q ': present in ' "${WORK}/pre-erasure.grep"; then
    say "REHEARSAL FAILED: the seeded subject is in no table of the pre-erasure dump"; exit 1
  fi
  # A chunk table the subject was never in would pass the grep after the erasure without proving the index lets them go.
  if ! grep -q -E ' of table index\."?chunk' "${WORK}/pre-erasure.grep"; then
    say "REHEARSAL FAILED: the seeded subject is in no chunk of the pre-erasure dump, so the dump grep after would prove nothing of the index"; exit 1
  fi
  # <<< found before
  say "dump grep before: the subject is in the pre-erasure copy, the index's chunk table among it (expected; the report's expiry dates cover it)"

  platform exec -T api pnpm --silent ops erasure-rehearsal --workspace "${DRILL_WORKSPACE}" --synthetic --run --report /tmp/erasure.md | tee -a "${REPORT}"
  platform exec -T api cat /tmp/erasure.md >> "${REPORT}"

  pg_dump --format=plain --dbname="${STAGING_DATABASE_URL}" > "${WORK}/post-erasure.sql"

  platform exec -T api pnpm --silent ops dump-grep --tokens "${subject}" < "${WORK}/post-erasure.sql" > "${WORK}/post-erasure.grep"
  cat "${WORK}/post-erasure.grep" >> "${REPORT}"
  # Those two keep the identifier by design. Present anywhere else, a store was missed.
  if leaked=$(grep ': present in ' "${WORK}/post-erasure.grep" | grep -v -E ' of table ([a-z_]+\.)?(subject_request|suppression)$'); then
    say "REHEARSAL FAILED: the subject is still held — ${leaked}"; exit 1
  fi
  say "dump grep after: the subject is in no table but subject_request and suppression, which keep the identifier set by design"

  # An empty set is a failure: the seed always commits, so nothing here means no read.
  if [ -z "${seeded_commits}" ]; then
    say "REHEARSAL FAILED: the seed added no commit to ${ws_repo} — step 7 would prove nothing"; exit 1
  fi
  for hash in ${seeded_commits}; do
    if ws_git cat-file -e "${hash}^{commit}" 2>/dev/null; then
      say "REHEARSAL FAILED: pre-rewrite commit ${hash} is still readable in ${ws_repo}"; exit 1
    fi
  done
  say "git cat-file: every pre-rewrite commit is gone from the bare repository ($(printf '%s\n' "${seeded_commits}" | grep -c . || true) checked)"
fi

rto=$(( ( $(date +%s) - T0 ) / 60 ))
say "## done — RTO ${rto} min"
rclone copyto "${REPORT}" "drillsink:${BACKUP_DUMPS_BUCKET}/drills/$(basename "${REPORT}")"
printf '%s' "insert into backup_run (kind, store, started_at, finished_at, outcome, bytes, location, report_url, contains_personal_data, rto_minutes) values ('drill', 'all', '${started}', now(), 'ok', 0, 'drills/', 'drills/$(basename "${REPORT}")', false, ${rto})" \
  | ${PROD_PSQL} -q -v ON_ERROR_STOP=1 || say "backup_run row not written to production (no backup_run table yet — it lands with the signals task)"
curl -fsS -m 10 -o /dev/null --data-raw "ok took=${rto}m" "${HEALTHCHECKS_PING_URL_DRILL}"
