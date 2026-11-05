#!/usr/bin/env bash
set -euo pipefail

: "${REPO_DIR:?set it to the repository checkout on VPC 2}"
: "${STAGING_ENV_FILE:?set it to the env file for the two staging stacks, with staging values for every key the two compose files require}"
: "${STAGING_DATABASE_URL:?}" "${STAGING_API_URL:?set it to http://127.0.0.1:3000 or the staging hostname}"
: "${BACKUP_DUMPS_BUCKET:?}" "${BACKUP_MIRROR_BUCKET:?}"
: "${BACKUP_AGE_IDENTITY_FILE:?set it to the root-only file on VPC 2 that holds the age identity (SECRETS.md, The backup identity)}"
: "${STAGING_OBJECTSTORE_ROOT_KEY:?}" "${STAGING_OBJECTSTORE_ROOT_SECRET:?}"
: "${STAGING_S3_BUCKET:=better-answers}"
: "${PROD_PSQL:?set it to a command that runs psql on production over SSH, as in the drill.env template that host-setup.sh writes}"
: "${DRILL_WORKSPACE:?set it to the id of the workspace the drill rebuilds and checks}"
: "${HEALTHCHECKS_PING_URL_DRILL:?}" "${HEALTHCHECKS_PING_URL_STAGING_WIPED:?}"
: "${RCLONE_CONFIG_DRILLSINK_ACCESS_KEY_ID:?set it to the write-and-list credential, which the drill uses only to upload its report}"

export RCLONE_CONFIG_STAGINGSTORE_TYPE=s3 RCLONE_CONFIG_STAGINGSTORE_PROVIDER=Other \
       RCLONE_CONFIG_STAGINGSTORE_ENDPOINT=http://127.0.0.1:3900 RCLONE_CONFIG_STAGINGSTORE_FORCE_PATH_STYLE=true \
       RCLONE_CONFIG_STAGINGSTORE_REGION=garage \
       RCLONE_CONFIG_STAGINGSTORE_ACCESS_KEY_ID="${STAGING_OBJECTSTORE_ROOT_KEY}" \
       RCLONE_CONFIG_STAGINGSTORE_SECRET_ACCESS_KEY="${STAGING_OBJECTSTORE_ROOT_SECRET}"

NOT_BUILT=3
# The api writes /data/git as this uid; the stores stack's init service makes it the store's owner.
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
# Both overrides declare this network external, and compose will not start a service on a missing external network.
STAGING_NETWORK=better-answers-staging-shared
# --internal: a plain bridge sorts first by name, so it would take every member's default route from its project network.
ensure_staging_network() {
  docker network inspect "${STAGING_NETWORK}" >/dev/null 2>&1 || docker network create --internal "${STAGING_NETWORK}" >/dev/null
}
# <<< the staging projects
# >>> the drill's commands
ops() {
  local rc=0; platform exec -T api pnpm --silent ops "$@" || rc=$?
  # ops reads its tables from the schema, so exit 3 (not built) after migrate means the restored copy lost a table.
  if [ "${rc}" -eq "${NOT_BUILT}" ]; then aside "DRILL FAILED: 'pnpm ops $1' exited 3 (not built). A table it needs is missing from the restored copy."; fi
  return "${rc}"
}
# <<< the drill's commands
wipe_staging() {
  # Leaves "${WORK}" alone: step 0 also calls this, and WORK holds the report being written.
  platform down --remove-orphans || true; stores down --remove-orphans || true
  sudo rm -rf /data/objectstore/* /data/git/* /data/worker/lmdb/* /data/worker/trees/* /data/backup/staging/*
  # >>> empty the database
  # restore-production.sh empties production with the same file, so `public` and its grants match production.
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

say "# Restore drill ${STAMP}, workspace ${DRILL_WORKSPACE}"
# >>> workspace id
synthetic_workspace=$("${DEPLOY_DIR}/seed-synthetic.sh" --workspace-id)
# Every ops command refuses a workspace id that is not a ULID. Check it now: the first ops command runs about 30 minutes in.
if ! [[ "${DRILL_WORKSPACE}" =~ ^[0-9A-HJKMNP-TV-Z]{26}$ ]]; then
  say "REFUSED: DRILL_WORKSPACE ${DRILL_WORKSPACE} is not a workspace id (a ULID). To drill the synthetic fixture, set it to ${synthetic_workspace}."; exit 1
fi
# <<< workspace id

say "## 0 Wipe staging"; ensure_staging_network; wipe_staging
say "## 1 Restore Postgres from the newest dump in any tier"
# >>> the newest dump
# The 02:05 dump goes to the weekly tier on Sundays and the monthly tier on the 1st, the drill's day.
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
# --no-owner: the restoring role owns every object; the dump still carries the grants.
pg_restore --no-owner --dbname="${STAGING_DATABASE_URL}" "${WORK}/pg.dump"
# <<< restore the database
say "restored ${latest}, taken ${dump_at}. RPO: $(( ( $(date +%s) - $(date -d "${dump_at:0:8} ${dump_at:9:2}:${dump_at:11:2}" +%s) ) / 60 )) min"

say "## 2 Start the stores, create the staging Garage key and bucket, and migrate"
stores up -d
stores exec -T objectstore /garage key import --yes -n drill-root \
  "${STAGING_OBJECTSTORE_ROOT_KEY}" "${STAGING_OBJECTSTORE_ROOT_SECRET}" || true
stores exec -T objectstore /garage key allow --create-bucket "${STAGING_OBJECTSTORE_ROOT_KEY}"
stores exec -T objectstore /garage bucket create "${STAGING_S3_BUCKET}" || true
stores exec -T objectstore /garage bucket allow --read --write "${STAGING_S3_BUCKET}" --key "${STAGING_OBJECTSTORE_ROOT_KEY}"
platform run --rm migrate

say "## 3 Restore the object store from the mirror bucket"
rclone sync "dumps:${BACKUP_MIRROR_BUCKET}/objectstore/" stagingstore:/

say "## 4 Restore the git store: one bare repository per workspace from its latest bundle"
# >>> the git store
# Git runs as the api's uid so that root owns no file in the store. That uid cannot enter WORK, which holds the decrypted dump.
chown "${API_UID}:${API_UID}" "${BUNDLES}"
# List before the loop: `for` ignores a failed listing, and the init below would then leave every workspace empty.
bundled=$(rclone lsf --dirs-only "dumps:${BACKUP_DUMPS_BUCKET}/git/" | tr -d /)
for ws in ${bundled}; do
  b=$(rclone lsf "dumps:${BACKUP_DUMPS_BUCKET}/git/${ws}/" | sort | tail -n1)
  rclone copyto "dumps:${BACKUP_DUMPS_BUCKET}/git/${ws}/${b}" "${WORK}/${ws}.bundle.age"
  age -d -i "${BACKUP_AGE_IDENTITY_FILE}" -o "${BUNDLES}/${ws}.bundle" "${WORK}/${ws}.bundle.age"
  chown "${API_UID}:${API_UID}" "${BUNDLES}/${ws}.bundle"
  sudo -u "#${API_UID}" git clone --quiet --bare "${BUNDLES}/${ws}.bundle" "/data/git/${ws}.git"
  rm -f "${BUNDLES}/${ws}.bundle"
done
# The nightly job bundles no repository without a ref, so a workspace with no writes yet has no bundle.
workspaces=$(psql "${STAGING_DATABASE_URL}" -X -At -c 'select id from workspace')
for ws in ${workspaces}; do
  [ -d "/data/git/${ws}.git" ] || sudo -u "#${API_UID}" git init --quiet --bare --initial-branch main "/data/git/${ws}.git"
done
# <<< the git store

say "## 5 Replay the erasures completed after the dump"
platform run --rm --no-deps api pnpm --silent ops replay-erasures --since "${dump_at}" | tee -a "${REPORT}"

say "## 5b Seed the synthetic fixture into the restored copy: its workspace rows, passage partition and an empty repository"
# No production dump holds the fixture. It is the only workspace the drill may always rebuild, seed a subject into, and erase.
STAGING_DATABASE_URL="${STAGING_DATABASE_URL}" "${DEPLOY_DIR}/seed-synthetic.sh" | tee -a "${REPORT}"
[ -d "/data/git/${synthetic_workspace}.git" ] || sudo -u "#${API_UID}" git init --quiet --bare --initial-branch main "/data/git/${synthetic_workspace}.git"

platform up -d --wait api worker
say "api is up. RTO so far: $(( ( $(date +%s) - T0 ) / 60 )) min"

say "## 6 Recovery steps 2 to 5: reconcile the watermark, rebuild the map, reprocess pipeline state (the LMDBs start empty), and list object-store orphans"
ops reconcile-watermark --workspace "${DRILL_WORKSPACE}"
t0=$(date +%s); ops map-rebuild --workspace "${DRILL_WORKSPACE}" --wait
say "map rebuilt in $(( $(date +%s) - t0 )) s (target: 120 s or less)"
ops map-sweep --workspace "${DRILL_WORKSPACE}"
ops object-store-orphans --workspace "${DRILL_WORKSPACE}" >> "${REPORT}"

say "## 7 Count the rebuilt map for this workspace"
# >>> the counts
ops map-counts --workspace "${DRILL_WORKSPACE}" > "${WORK}/staging.counts"
if [ ! -s "${WORK}/staging.counts" ]; then say "DRILL FAILED: map-counts printed no counts for ${DRILL_WORKSPACE}"; exit 1; fi
cat "${WORK}/staging.counts" >> "${REPORT}"
# Production's map changes after the dump, so only a recorded run is a fair comparison, and production records none yet.
say "staging counts recorded but not compared: production records no run of the map's counts"
# <<< the counts

say "## 8 Smoke test through the interface: health, discovery, the shell, find, a guide read, and ask"
platform exec -T api pnpm --silent ops smoke --workspace "${DRILL_WORKSPACE}" --url "${STAGING_API_URL}" --find --guide --ask >> "${REPORT}"

say "## 9 Count the dump copies in each tier (the bucket lifecycle sets the tiers, not Coolify's schedule)"
for tier in hourly daily weekly monthly; do printf '%s: %s copies\n' "${tier}" "$(rclone lsf "dumps:${BACKUP_DUMPS_BUCKET}/pg/${tier}/" | wc -l)" >> "${REPORT}"; done

if [ $(( $(date +%-m) % 3 )) -eq 0 ]; then
  say "## 10 Rehearse an erasure on a synthetic subject and prove that it removes the subject"
  ws_repo="/data/git/${DRILL_WORKSPACE}.git"
  ws_git() { sudo -u "#${API_UID}" git -C "${ws_repo}" "$@"; }
  commits_before_seed=$({ ws_git rev-list --all 2>/dev/null || true; } | sort)

  # The deploy-tree test runs the lines between these markers.
  # >>> seed status
  seed_rc=0
  # The seed's index job queues behind whatever the restore left for the drill workspace.
  subject=$(platform exec -T api pnpm --silent ops erasure-rehearsal --workspace "${DRILL_WORKSPACE}" --synthetic --seed --wait-seconds 600 | tail -n1) || seed_rc=$?
  if [ "${seed_rc}" -eq "${NOT_BUILT}" ]; then
    say "REHEARSAL FAILED: the synthetic seed exited 3 (not built). A table the erasure needs is missing from the restored copy."; exit 1
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
    say "REHEARSAL FAILED: the pre-erasure dump does not contain the seeded subject in any table"; exit 1
  fi
  # If no passage table holds the subject, the grep after the erasure passes without testing the index.
  if ! grep -q -E ' of table index\."?passage' "${WORK}/pre-erasure.grep"; then
    say "REHEARSAL FAILED: no passage table in the pre-erasure dump contains the seeded subject, so the grep after the erasure cannot test the index"; exit 1
  fi
  # <<< found before
  say "dump grep before the erasure: the subject is in the pre-erasure copy, including the index's passage table. This is expected; the report's expiry dates cover it."

  platform exec -T api pnpm --silent ops erasure-rehearsal --workspace "${DRILL_WORKSPACE}" --synthetic --run --report /tmp/erasure.md | tee -a "${REPORT}"
  platform exec -T api cat /tmp/erasure.md >> "${REPORT}"

  pg_dump --format=plain --dbname="${STAGING_DATABASE_URL}" > "${WORK}/post-erasure.sql"

  platform exec -T api pnpm --silent ops dump-grep --tokens "${subject}" < "${WORK}/post-erasure.sql" > "${WORK}/post-erasure.grep"
  cat "${WORK}/post-erasure.grep" >> "${REPORT}"
  # subject_request and suppression keep the identifier by design. A match in any other table means the erasure missed a store.
  if leaked=$(grep ': present in ' "${WORK}/post-erasure.grep" | grep -v -E ' of table ([a-z_]+\.)?(subject_request|suppression)$'); then
    say "REHEARSAL FAILED: the erasure left the subject in the database: ${leaked}"; exit 1
  fi
  say "dump grep after the erasure: the subject is only in subject_request and suppression, which keep the identifier set by design"

  # The seed always commits, so an empty list means the commits were not read.
  if [ -z "${seeded_commits}" ]; then
    say "REHEARSAL FAILED: the seed added no commit to ${ws_repo}, so the commit check below cannot prove anything"; exit 1
  fi
  for hash in ${seeded_commits}; do
    if ws_git cat-file -e "${hash}^{commit}" 2>/dev/null; then
      say "REHEARSAL FAILED: pre-rewrite commit ${hash} is still readable in ${ws_repo}"; exit 1
    fi
  done
  say "git cat-file: every pre-rewrite commit is gone from the bare repository ($(printf '%s\n' "${seeded_commits}" | grep -c . || true) checked)"
fi

rto=$(( ( $(date +%s) - T0 ) / 60 ))
say "## Done. RTO: ${rto} min"
rclone copyto "${REPORT}" "drillsink:${BACKUP_DUMPS_BUCKET}/drills/$(basename "${REPORT}")"
# >>> record the drill
printf '%s' "insert into backup (kind, store, started_at, finished_at, outcome, bytes, location, report_url, contains_personal_data, rto_minutes) values ('drill', 'all', '${started}', now(), 'ok', NULL, 'drills/', 'drills/$(basename "${REPORT}")', false, ${rto})" \
  | ${PROD_PSQL} -q -v ON_ERROR_STOP=1 || say "backup row not written to production"
# <<< record the drill
curl -fsS -m 10 -o /dev/null --data-raw "ok took=${rto}m" "${HEALTHCHECKS_PING_URL_DRILL}"
