#!/usr/bin/env bash
set -euo pipefail

refuse() { printf 'browse-production: REFUSED: %s\n' "$*" >&2; exit 1; }

is_port() { [[ "$1" =~ ^[1-9][0-9]{0,4}$ ]] && [ "$1" -le 65535 ]; }

local_port="${BROWSE_PORT:-55433}"
is_port "${local_port}" || refuse "BROWSE_PORT is not a port number."

if [ -z "${ESTATE_FILE:-}" ]; then
  checkout="$(git -C "$(dirname "$0")" rev-parse --path-format=absolute --git-common-dir)/.."
  ESTATE_FILE="${checkout}/.planning/estate/coolify.md"
fi
[ -r "${ESTATE_FILE}" ] || refuse "cannot read ${ESTATE_FILE}. Set ESTATE_FILE to the private estate file that holds VPC1_SSH_TARGET, VPC1_DATABASE_PORT and VPC1_SSH_KEY."

# The estate file is prose, so read the three NAME= lines from it and never source it.
value_of() {
  local lines
  lines="$(grep -cE "^$1=" "${ESTATE_FILE}" || true)"
  [ "${lines}" -le 1 ] || refuse "$1 appears ${lines} times in the estate file. Keep one line."
  sed -n "s/^$1=//p" "${ESTATE_FILE}" | tr -d '\r' | sed -E 's/[[:space:]]+$//'
}

target="$(value_of VPC1_SSH_TARGET)"
remote_port="$(value_of VPC1_DATABASE_PORT)"
key="$(value_of VPC1_SSH_KEY)"

[ -n "${target}" ] || refuse "the estate file has no VPC1_SSH_TARGET line. Add one in the form user@host."
[[ "${target}" =~ ^[A-Za-z0-9._-]+@[A-Za-z0-9.:-]+$ ]] || refuse "VPC1_SSH_TARGET in the estate file is not in the form user@host."
[ -n "${remote_port}" ] || refuse "the estate file has no VPC1_DATABASE_PORT line. Add the database port that production publishes on the box."
is_port "${remote_port}" || refuse "VPC1_DATABASE_PORT in the estate file is not a port number."
case "${key}" in \~/*) key="${HOME}/${key#\~/}" ;; esac
[ -z "${key}" ] || [ -r "${key}" ] || refuse "VPC1_SSH_KEY in the estate file does not name a readable file."

if (exec 3<>"/dev/tcp/127.0.0.1/${local_port}") 2>/dev/null; then
  refuse "127.0.0.1:${local_port} is taken. Stop the process listening there, or choose another port with BROWSE_PORT."
fi

ssh_options=(-N -T
  -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=4 -o ConnectTimeout=10)
[ -z "${key}" ] || ssh_options+=(-o IdentitiesOnly=yes -i "${key}")

printf "browse-production: production's database is on 127.0.0.1:%s. Connect to database better_answers as user browse_ro.\n" "${local_port}"
printf 'browse-production: the tunnel stays open while this runs; Ctrl-C closes it\n'
exec ssh "${ssh_options[@]}" -L "127.0.0.1:${local_port}:127.0.0.1:${remote_port}" "${target}"
