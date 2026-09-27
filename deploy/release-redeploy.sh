#!/usr/bin/env bash
# Every call must answer 2xx: the edge answers a missing credential with a redirect, which
# `curl -f` counts as success.
set -euo pipefail

refuse() {
  echo "::error::$1" >&2
  exit 1
}

[ "$#" -eq 2 ] || refuse "usage: release-redeploy.sh <api digest> <worker digest>, given $# arguments"
for name in COOLIFY_URL COOLIFY_TOKEN CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET PROD_UUID; do
  [ -n "${!name:-}" ] ||
    refuse "${name} is empty, so the orchestrator cannot be reached. A called release reads an environment secret only when its caller passes the secret's name"
done

coolify() {
  local method="$1" path="$2" answer code
  shift 2
  answer="$(mktemp)"
  code="$(curl -sS --max-redirs 0 --max-time 30 -o "${answer}" -w '%{http_code}' -X "${method}" "${COOLIFY_URL}${path}" \
    -H "Authorization: Bearer ${COOLIFY_TOKEN}" -H "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}" \
    -H "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET}" "$@")" || code="no answer"
  cat "${answer}"
  echo
  case "${code}" in
    2??) ;;
    3??) refuse "${method} ${path} was answered ${code}, a redirect to sign-in: the edge's Access credential is missing or expired, so nothing reached the orchestrator" ;;
    *) refuse "${method} ${path} was answered ${code}, so the release stops before anything else is sent" ;;
  esac
}

patch() {
  jq -cn --arg key "$1" --arg value "$2" '{key: $key, value: $value, is_preview: false}' |
    coolify PATCH "/api/v1/applications/${PROD_UUID}/envs" -H "Content-Type: application/json" --data-binary @-
}

patch API_IMAGE_DIGEST "$1"
patch WORKER_IMAGE_DIGEST "$2"
# A POST: the orchestrator answers a GET on /deploy with 405, hidden behind a 403.
coolify POST "/api/v1/deploy?uuid=${PROD_UUID}&force=false"
