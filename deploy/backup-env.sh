#!/usr/bin/env bash
set -euo pipefail

# The orchestrator hands the container every stores variable, the tunnel and Garage secrets
# among them, so only the names the jobs read pass.
readonly JOB_VARIABLES=(
  PATH
  HOME
  DATABASE_URL
  BACKUP_AGE_RECIPIENT
  BACKUP_DUMPS_BUCKET
  BACKUP_MIRROR_BUCKET
  GIT_MIRROR_SSH_TARGET
  HEALTHCHECKS_PING_URL_PG_HOURLY
  HEALTHCHECKS_PING_URL_NIGHTLY
  RCLONE_CONFIG_DUMPS_TYPE
  RCLONE_CONFIG_DUMPS_PROVIDER
  RCLONE_CONFIG_DUMPS_ENDPOINT
  RCLONE_CONFIG_DUMPS_ACCESS_KEY_ID
  RCLONE_CONFIG_DUMPS_SECRET_ACCESS_KEY
  RCLONE_CONFIG_SRC_TYPE
  RCLONE_CONFIG_SRC_PROVIDER
  RCLONE_CONFIG_SRC_ENDPOINT
  RCLONE_CONFIG_SRC_FORCE_PATH_STYLE
  RCLONE_CONFIG_SRC_REGION
  RCLONE_CONFIG_SRC_ACCESS_KEY_ID
  RCLONE_CONFIG_SRC_SECRET_ACCESS_KEY
)

passes() {
  local name
  for name in "${JOB_VARIABLES[@]}"; do
    if [ "$1" = "${name}" ]; then return 0; fi
  done
  return 1
}

# `docker exec` hands a run by hand the whole environment, so it is cleared to match cron's.
for name in $(compgen -e); do
  passes "${name}" || unset "${name}"
done

# cron gives a job none of the container's environment. PID 1 holds it, root-only, so no
# file ever carries a copy.
while IFS= read -r -d '' pair; do
  if passes "${pair%%=*}"; then export "${pair}"; fi
done < /proc/1/environ

exec "$@"
