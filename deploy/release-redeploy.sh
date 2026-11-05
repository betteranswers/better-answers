#!/usr/bin/env bash
set -euo pipefail

# Coolify runs the compose build command before it stops the running containers, so this pull
# puts both images on the box before the swap starts.
readonly PULL_STEP="docker compose pull --policy missing"

refuse() {
  echo "::error::$1" >&2
  exit 1
}

[ "$#" -eq 2 ] || refuse "usage: release-redeploy.sh <api digest> <worker digest>. Got $# arguments."
for name in COOLIFY_URL COOLIFY_TOKEN CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET PROD_UUID; do
  [ -n "${!name:-}" ] ||
    refuse "${name} is empty, so the release cannot reach the orchestrator. A called workflow reads an environment secret only if its caller passes that secret by name, so check the secrets: block in the workflow that calls release.yml."
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
    3??) refuse "${method} ${path} got ${code}, a redirect to the sign-in page, so the call never reached the orchestrator. The Cloudflare Access service token (CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET) is missing or expired." ;;
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
    401 | 403) refuse "$1 $2 got ${code}. The response above says which cause applies: the Coolify token is invalid, the token lacks the \`${ability}\` ability, or Cloudflare Access refused the service token. The Coolify token needs the \`read\`, \`write\` and \`deploy\` abilities." ;;
    *) refuse "$1 $2 got ${code}, so the release stopped and sent no further requests. The response above says why." ;;
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
  refuse "GET /api/v1/deployments/applications/${PROD_UUID} did not return a list of deployments, so the release cannot tell whether a deployment is queued or running. It changed nothing."
active="$(jq -r '[.deployments[] | select(.status == "queued" or .status == "in_progress") | "\(.deployment_uuid) is \(.status)"][0] // empty' "${answer}")"
[ -z "${active}" ] ||
  refuse "Production deployment ${active}, so the release changed nothing: a deployment that has not started would pick up the new digests. Wait for it to end, or cancel it in the orchestrator, then run the release again."

if [ "${build_command}" != "${PULL_STEP}" ]; then
  jq -cn --arg command "${PULL_STEP}" '{docker_compose_custom_build_command: $command}' |
    coolify write PATCH "/api/v1/applications/${PROD_UUID}" -H "Content-Type: application/json" --data-binary @-
  echo "Set the compose build command to \`${PULL_STEP}\`."
fi

patch API_IMAGE_DIGEST "$1"
patch WORKER_IMAGE_DIGEST "$2"
# POST, not GET: the orchestrator answers a GET on /deploy with a 403 that hides a 405.
coolify deploy POST "/api/v1/deploy?uuid=${PROD_UUID}&force=false"
deployment="$(jq -r '.deployments[0].deployment_uuid // empty' "${answer}" 2>/dev/null)" || deployment=""
[ -n "${deployment}" ] || refuse "POST /api/v1/deploy returned no deployment_uuid, so the release cannot wait for the deployment. Find the deployment in the orchestrator and read /health once it ends."
# Coolify 4.3.13 answers a skipped deploy with a fresh id it never queued.
if [ "$(jq -r '.deployments[0].message // empty' "${answer}")" = "Deployment already queued for this commit." ]; then
  refuse "The orchestrator did not queue a deployment: another production deployment was queued after this release checked, and the returned id ${deployment} does not exist. Both digests are set, so that other deployment uses them if it has not started, but no smoke test or tag follows it. When it ends, read /health, then run the release again."
fi
echo "Deploying production as deployment ${deployment}."

status="unread"
deadline=$((SECONDS + wait_seconds))
while ((SECONDS <= deadline)); do
  code="$(ask GET "/api/v1/deployments/${deployment}")"
  if [[ "${code}" == 2?? ]]; then
    status="$(jq -r '.status // "none"' "${answer}" 2>/dev/null)" || status="unreadable"
    case "${status}" in
      finished)
        echo "Deployment ${deployment} finished."
        exit 0
        ;;
      queued | in_progress) ;;
      *) refuse "Deployment ${deployment} ended with status ${status}. Read its log in the orchestrator. If it failed before the line \`Removing old containers.\`, production still runs the previous release." ;;
    esac
  fi
  sleep "${delay}"
done
refuse "Deployment ${deployment} did not finish within ${wait_seconds} s of being queued. Its last status was ${status}. It may still replace the production containers later, so read /health before you act."
