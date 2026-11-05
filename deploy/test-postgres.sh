#!/usr/bin/env bash
set -euo pipefail

deploy="$(cd "$(dirname "$0")" && pwd)"
repo="$(dirname "${deploy}")"
stem="${TEST_POSTGRES_PROJECT:-better-answers-test-postgres}"

say() { printf 'test-postgres: %s\n' "$*"; }
refuse() { printf 'test-postgres: REFUSED: %s\n' "$*" >&2; exit 1; }
usage() { printf 'usage: deploy/test-postgres.sh up | down [--all] | address\n' >&2; exit 64; }

pinned="$(grep -oE '"[^"]+@sha256:[0-9a-f]{64}"' "${repo}/packages/schema/src/postgres-image.ts" | tr -d '"' || true)"
[ "$(printf '%s' "${pinned}" | grep -c '')" -eq 1 ] \
  || refuse "packages/schema/src/postgres-image.ts must pin exactly one image by digest (name@sha256:<64 hex characters>)."
pinned="${TEST_POSTGRES_IMAGE:-${pinned}}"
digest="${pinned##*@sha256:}"
[[ "${digest}" =~ ^[0-9a-f]{64}$ ]] || refuse "TEST_POSTGRES_IMAGE must name an image by digest (name@sha256:<64 hex characters>)."

# Each pinned image gets its own server, so worktrees on different pins never share one.
project="${stem}-${digest:0:12}"
derived_port="$((55434 + 16#${digest:0:4} % 1000))"
port="${TEST_POSTGRES_PORT:-${derived_port}}"
[[ "${port}" =~ ^[1-9][0-9]{0,4}$ ]] && [ "${port}" -le 65535 ] || refuse "TEST_POSTGRES_PORT is not a port number."
export TEST_POSTGRES_IMAGE="${pinned}" TEST_POSTGRES_PORT="${port}"

composeOn() { docker compose -f "${deploy}/test-postgres.compose.yaml" -p "$@"; }
compose() { composeOn "${project}" "$@"; }

# Filtered here because Docker's label filters match only exact values. The stem never matches the dev database's project.
underStem() {
  pattern="^${stem}(-[0-9a-f]{12})?\$"
  docker compose ls "$@" -q | while IFS= read -r name; do
    if [[ "${name}" =~ ${pattern} ]]; then printf '%s\n' "${name}"; fi
  done
}

up() {
  existing="$(compose ps -a -q postgres)"
  if [ -n "${existing}" ]; then
    image="$(docker inspect --format '{{.Config.Image}}' "${existing}")"
    # Recreating the server would wipe every other worktree's running suite, so the operator must stop it.
    [ "${image}" = "${pinned}" ] \
      || refuse "${project} runs ${image}, but this checkout pins ${pinned}. Run deploy/test-postgres.sh down, then up."
  fi
  if [ -z "$(compose ps -q --status running postgres)" ] \
    && (exec 3<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null; then
    refuse "127.0.0.1:${port} is taken. Stop the process listening there, or choose another port with TEST_POSTGRES_PORT."
  fi
  compose up -d --wait --quiet-pull --no-recreate
  # A running instance keeps the port it started on, whatever TEST_POSTGRES_PORT says now.
  bound="$(compose port postgres 5432)"
  say "up on ${bound}; point the test suites at it with:"
  printf 'export TEST_POSTGRES_URI=shared\n'
  # The test harnesses derive the same port from the pin, so tell them the port when the server is on another one.
  [ "${bound##*:}" = "${derived_port}" ] || printf 'export TEST_POSTGRES_PORT=%s\n' "${bound##*:}"
  say "deploy/test-postgres.sh down stops it and deletes all its data."
  others="$(underStem | grep -vxF "${project}" | tr '\n' ' ' || true)"
  [ -z "${others}" ] || say "also running: ${others% }. Run deploy/test-postgres.sh down --all to stop them."
}

downAll() {
  names="$(underStem --all)"
  for name in ${names}; do composeOn "${name}" down; done
}

case "${1:-}" in
  up) [ "$#" -eq 1 ] || usage; up ;;
  down)
    case "$#:${2:-}" in
      1:) compose down ;;
      2:--all) downAll ;;
      *) usage ;;
    esac ;;
  address)
    [ "$#" -eq 1 ] || usage
    printf 'project %s\nuri postgresql://postgres:postgres@127.0.0.1:%s/postgres\n' "${project}" "${port}" ;;
  *) usage ;;
esac
