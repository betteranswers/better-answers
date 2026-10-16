#!/usr/bin/env bash
set -euo pipefail

deploy="$(cd "$(dirname "$0")" && pwd)"
repo="$(dirname "${deploy}")"
project="${TEST_POSTGRES_PROJECT:-better-answers-test-postgres}"
port="${TEST_POSTGRES_PORT:-55433}"

say() { printf 'test-postgres: %s\n' "$*"; }
refuse() { printf 'test-postgres: REFUSED — %s\n' "$*" >&2; exit 1; }
usage() { printf 'usage: deploy/test-postgres.sh up | down\n' >&2; exit 64; }

[[ "${port}" =~ ^[1-9][0-9]{0,4}$ ]] && [ "${port}" -le 65535 ] || refuse "TEST_POSTGRES_PORT is not a port number"

pinned="$(grep -oE '"[^"]+@sha256:[0-9a-f]{64}"' "${repo}/packages/schema/src/postgres-image.ts" | tr -d '"' || true)"
[ "$(printf '%s' "${pinned}" | grep -c '')" -eq 1 ] \
  || refuse "packages/schema/src/postgres-image.ts must pin exactly one image by digest"
export TEST_POSTGRES_IMAGE="${pinned}" TEST_POSTGRES_PORT="${port}"

compose() { docker compose -f "${deploy}/test-postgres.compose.yaml" -p "${project}" "$@"; }

up() {
  existing="$(compose ps -a -q postgres)"
  if [ -n "${existing}" ]; then
    image="$(docker inspect --format '{{.Config.Image}}' "${existing}")"
    # Recreating it would wipe every other worktree's live run, so the owner stops it knowingly.
    [ "${image}" = "${pinned}" ] \
      || refuse "${project} runs ${image}, and this checkout pins ${pinned} — deploy/test-postgres.sh down, then up"
  fi
  if [ -z "$(compose ps -q --status running postgres)" ] \
    && (exec 3<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null; then
    refuse "127.0.0.1:${port} is taken — stop what listens there, or choose another port with TEST_POSTGRES_PORT"
  fi
  compose up -d --wait --quiet-pull --no-recreate
  # A running instance keeps the port it started on, whatever TEST_POSTGRES_PORT says now.
  bound="$(compose port postgres 5432)"
  say "up on ${bound}; point the test suites at it with:"
  printf 'export TEST_POSTGRES_URI=postgresql://postgres:postgres@%s/postgres\n' "${bound}"
  say "deploy/test-postgres.sh down stops it and discards all its data"
}

case "${1:-}" in
  up) [ "$#" -eq 1 ] || usage; up ;;
  down) [ "$#" -eq 1 ] || usage; compose down ;;
  *) usage ;;
esac
