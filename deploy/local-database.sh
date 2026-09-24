#!/usr/bin/env bash
set -euo pipefail

deploy="$(cd "$(dirname "$0")" && pwd)"
repo="$(dirname "${deploy}")"
project="${LOCAL_DATABASE_PROJECT:-better-answers-local}"
port="${LOCAL_DATABASE_PORT:-55432}"
owner_dsn() { printf 'postgresql://better_answers:better_answers@127.0.0.1:%s/better_answers' "$1"; }

say() { printf 'local-database: %s\n' "$*"; }
refuse() { printf 'local-database: REFUSED — %s\n' "$*" >&2; exit 1; }
usage() { printf 'usage: deploy/local-database.sh up | down [--wipe]\n' >&2; exit 64; }

[[ "${port}" =~ ^[1-9][0-9]{0,4}$ ]] && [ "${port}" -le 65535 ] || refuse "LOCAL_DATABASE_PORT is not a port number"

pinned="$(grep -oE '"[^"]+@sha256:[0-9a-f]{64}"' "${repo}/packages/schema/src/postgres-image.ts" | tr -d '"' || true)"
[ "$(printf '%s' "${pinned}" | grep -c '')" -eq 1 ] \
  || refuse "packages/schema/src/postgres-image.ts must pin exactly one image by digest"
export LOCAL_POSTGRES_IMAGE="${pinned}" LOCAL_DATABASE_PORT="${port}"

compose() { docker compose -f "${deploy}/local.compose.yaml" -p "${project}" "$@"; }
in_database() { compose exec -T postgres "$@"; }

up() {
  if [ -z "$(compose ps -q --status running postgres)" ] \
    && (exec 3<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null; then
    refuse "127.0.0.1:${port} is taken — stop what listens there, or choose another port with LOCAL_DATABASE_PORT"
  fi
  compose up -d --wait --quiet-pull
  (cd "${repo}" && DATABASE_URL="$(owner_dsn "${port}")" pnpm --silent migrate)
  # The seed keys its workspace by slug, so a fixture seeded under an earlier id would fail it on a foreign key.
  synthetic="$("${deploy}/seed-synthetic.sh" --workspace-id)"
  standing="$(in_database psql -qAt -U better_answers -d better_answers -c "SELECT id FROM workspace WHERE slug = 'synthetic'")"
  [ -z "${standing}" ] || [ "${standing}" = "${synthetic}" ] \
    || refuse "this database holds the synthetic fixture under ${standing}, and its workspace is ${synthetic} now — deploy/local-database.sh down --wipe, then up"
  in_database /repo/deploy/seed-synthetic.sh "$(owner_dsn 5432)"
  in_database psql -q -v ON_ERROR_STOP=1 -U better_answers -d better_answers -f /repo/deploy/browse-role.sql
  in_database psql -q -v ON_ERROR_STOP=1 -U better_answers -d better_answers -c "ALTER ROLE browse_ro PASSWORD 'browse_ro'"
  say "up on 127.0.0.1:${port}, database better_answers — a GUI signs in as browse_ro (password browse_ro), psql as better_answers (password better_answers)"
  say "deploy/local-database.sh down stops it and keeps the data; down --wipe drops the data too"
}

case "${1:-}" in
  up) [ "$#" -eq 1 ] || usage; up ;;
  down)
    case "$#:${2:-}" in
      1:) compose down ;;
      2:--wipe) compose down --volumes ;;
      *) usage ;;
    esac
    ;;
  *) usage ;;
esac
