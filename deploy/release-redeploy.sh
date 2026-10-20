#!/usr/bin/env bash
set -euo pipefail

# Coolify runs the compose build command before it stops the running containers (BA-219), so both
# images are on the box before the swap starts.
readonly PULL_STEP="docker compose pull --policy missing"

refuse() {
  echo "::error::$1" >&2
  exit 1
}

[ "$#" -eq 2 ] || refuse "usage: release-redeploy.sh <api digest> <worker digest>, given $# arguments"
for name in COOLIFY_URL COOLIFY_TOKEN CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET PROD_UUID; do
  [ -n "${!name:-}" ] ||
    refuse "${name} is empty, so the orchestrator cannot be reached. A called release reads an environment secret only when its caller passes the secret's name"
done

wait_seconds="${RELEASE_DEPLOY_WAIT_SECONDS:-1800}"
delay="${RELEASE_DEPLOY_DELAY_SECONDS:-10}"

answer="$(mktemp)"
trap 'rm -f "${answer}"' EXIT

ask() {
  local method="$1" path="$2" code
  shift 2
  code="$(curl -sS --max-redirs 0 --max-time 30 -o "${answer}" -w '%{http_code}' -X "${method}" "${COOLIFY_URL}${path}" \
    -H "Authorization: Bearer ${COOLIFY_TOKEN}" -H "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}" \
    -H "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET}" "$@")" || code="no answer"
  case "${code}" in
    3??) refuse "${method} ${path} was answered ${code}, a redirect to sign-in: the edge's Access credential is missing or expired, so the call never reached the orchestrator" ;;
  esac
  echo "${code}"
}

coolify() {
  local ability="$1" code
  shift
  code="$(ask "$@")"
  case "${code}" in
    2??) return ;;
  esac
  cat "${answer}"
  echo
  case "${code}" in
    401 | 403) refuse "$1 $2 was answered ${code}: the token is not live, or lacks Coolify's \`${ability}\` ability, or the edge refused its service token, as the answer above says. The release's token needs \`read\`, \`write\` and \`deploy\`" ;;
    *) refuse "$1 $2 was answered ${code}, so the release stops before anything else is sent" ;;
  esac
}

patch() {
  jq -cn --arg key "$1" --arg value "$2" '{key: $key, value: $value, is_preview: false, is_buildtime: true, is_runtime: true}' |
    coolify write PATCH "/api/v1/applications/${PROD_UUID}/envs" -H "Content-Type: application/json" --data-binary @-
}

coolify read GET "/api/v1/applications/${PROD_UUID}"
build_command="$(jq -r '.docker_compose_custom_build_command // empty' "${answer}")"

coolify read GET "/api/v1/deployments/applications/${PROD_UUID}"
jq -e '.deployments | arrays' "${answer}" >/dev/null 2>&1 ||
  refuse "GET /api/v1/deployments/applications/${PROD_UUID} answered no list of deployments, so the release cannot tell whether one is queued or running, and sets nothing"
active="$(jq -r '[.deployments[] | select(.status == "queued" or .status == "in_progress") | "\(.deployment_uuid) is \(.status)"][0] // empty' "${answer}")"
[ -z "${active}" ] ||
  refuse "production's deployment ${active}, so the release sets nothing: a deployment not yet started reads the digests set before it starts. Let it end, or cancel it in the orchestrator, then run the release again"

if [ "${build_command}" != "${PULL_STEP}" ]; then
  jq -cn --arg command "${PULL_STEP}" '{docker_compose_custom_build_command: $command}' |
    coolify write PATCH "/api/v1/applications/${PROD_UUID}" -H "Content-Type: application/json" --data-binary @-
  echo "the compose build command is now \`${PULL_STEP}\`"
fi

patch API_IMAGE_DIGEST "$1"
patch WORKER_IMAGE_DIGEST "$2"
# A POST: the orchestrator answers a GET on /deploy with 405, hidden behind a 403.
coolify deploy POST "/api/v1/deploy?uuid=${PROD_UUID}&force=false"
deployment="$(jq -r '.deployments[0].deployment_uuid // empty' "${answer}" 2>/dev/null)" || deployment=""
[ -n "${deployment}" ] || refuse "POST /api/v1/deploy named no deployment_uuid, so the release cannot wait for the deployment"
# Coolify 4.3.13 answers a skipped deploy with a fresh id it never queued.
if [ "$(jq -r '.deployments[0].message // empty' "${answer}")" = "Deployment already queued for this commit." ]; then
  refuse "the orchestrator queued no deployment, because one of production was queued after this release checked for one, and the id it answered, ${deployment}, names nothing. Both digests are set, and that deployment reads them if it has not started, with no smoke and no tag after it. Read /health once it ends, then run the release again"
fi
echo "deploying production as deployment ${deployment}"

status="unread"
deadline=$((SECONDS + wait_seconds))
while ((SECONDS <= deadline)); do
  code="$(ask GET "/api/v1/deployments/${deployment}")"
  if [[ "${code}" == 2?? ]]; then
    status="$(jq -r '.status // "none"' "${answer}" 2>/dev/null)" || status="unreadable"
    case "${status}" in
      finished)
        echo "deployment ${deployment} finished"
        exit 0
        ;;
      queued | in_progress) ;;
      *) refuse "deployment ${deployment} ended ${status}. Read its log in the orchestrator. A failure before \`Removing old containers.\` left production running the release before this one" ;;
    esac
  fi
  sleep "${delay}"
done
refuse "deployment ${deployment} had not finished ${wait_seconds} s after it was queued, and its last status read was ${status}. It may still swap production later, so read /health before acting"
