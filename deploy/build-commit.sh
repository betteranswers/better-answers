#!/usr/bin/env bash
# A rollback night runs the old images, so the journeys check out the commit the live api image was built from, not main's head.
set -euo pipefail

usage() {
  echo "::error::usage: build-commit.sh <api digest> — $1" >&2
  exit 2
}

refuse() {
  echo "::error::$1" >&2
  exit 1
}

[ "$#" -eq 1 ] || usage "takes one argument, and was given $#"
digest="$1"
[[ "${digest}" =~ ^sha256:[0-9a-f]{64}$ ]] || usage "${digest} is not a digest (sha256: followed by 64 hex characters)"

for name in OWNER REGISTRY_USER REGISTRY_TOKEN; do
  [ -n "${!name:-}" ] ||
    refuse "${name} is empty, so the registry cannot be asked which commit the api image was built from, and the journeys could not run"
done
registry="${REGISTRY_URL:-https://ghcr.io}"
main="${MAIN_REF:-origin/main}"
image="${OWNER}/api"
unknown="so the api image's commit is unknown and the journeys could not run"

answer="$(mktemp)"
trap 'rm -f "${answer}"' EXIT

asked() {
  local request="$1" code
  shift
  code="$(curl -sS --max-time 20 -o "${answer}" -w '%{http_code}' "$@")" ||
    refuse "the registry did not answer the ${request}, ${unknown}"
  [ "${code}" = 200 ] || refuse "the registry answered ${code} to the ${request}, ${unknown}"
}

read_answer() { jq -r "$1 // empty" "${answer}" 2>/dev/null || true; }

asked "token request for ${image}" -u "${REGISTRY_USER}:${REGISTRY_TOKEN}" \
  "${registry}/token?scope=repository:${image}:pull&service=ghcr.io"
token="$(read_answer .token)"
[ -n "${token}" ] || refuse "the registry's answer to the token request for ${image} carries no token, ${unknown}"

asked "manifest request for ${image}@${digest}" -H "Authorization: Bearer ${token}" \
  -H "Accept: application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json" \
  "${registry}/v2/${image}/manifests/${digest}"
config="$(read_answer .config.digest)"
[[ "${config}" =~ ^sha256:[0-9a-f]{64}$ ]] || refuse "the manifest of ${image}@${digest} names no config, ${unknown}"

# The registry redirects a blob to storage on another host, where curl rightly withholds the bearer: never --location-trusted.
asked "config request for ${image}@${config}" -L --max-redirs 3 -H "Authorization: Bearer ${token}" \
  "${registry}/v2/${image}/blobs/${config}"
commit="$(read_answer '.config.Labels["org.opencontainers.image.revision"]')"
[[ "${commit}" =~ ^[0-9a-f]{40}$ ]] ||
  refuse "${image}@${digest} has no org.opencontainers.image.revision label naming a full commit, ${unknown}"

git rev-parse --verify --quiet "${main}^{commit}" >/dev/null ||
  refuse "${main} is not in this checkout (a checkout with fetch-depth: 0 has it), so whether ${commit} is on main is unknown and the journeys could not run"
git cat-file -e "${commit}^{commit}" 2>/dev/null ||
  refuse "${image}@${digest} was built from ${commit}, which this checkout does not have, so the journeys could not run"
git merge-base --is-ancestor "${commit}" "${main}" ||
  refuse "${image}@${digest} was built from ${commit}, which is not on ${main}, so the journeys could not run"
echo "${commit}"
