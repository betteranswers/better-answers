#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: prune-images.sh [--dry-run] [--keep <unused images kept per repository, default 2>]" >&2
  exit 2
}

readonly PREFIX=ghcr.io/betteranswers/
readonly TAB=$'\t'
dry_run=false
keep=2
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=true; shift ;;
    --keep) [ $# -ge 2 ] || usage; keep=$2; shift 2 ;;
    *) usage ;;
  esac
done
case "${keep}" in '' | *[!0-9]*) usage ;; esac

say() { printf '%s prune-images: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
disk() { df -P / | awk 'NR == 2 { print $5 }'; }

running=$(docker ps --format '{{.Image}}')
if [[ "${running}" == *coolify-helper* ]]; then
  say "skipped: a Coolify deployment is running, so its images may not be in use yet"
  exit 0
fi

in_use=$(docker ps -aq | xargs -r docker inspect --format '{{.Image}}' | tr '\n' ' ')
plan=$(
  docker image ls --no-trunc --format '{{.Repository}}\t{{.ID}}\t{{.CreatedAt}}' |
    awk -F "${TAB}" -v prefix="${PREFIX}" 'index($1, prefix) == 1' |
    sort -t "${TAB}" -k1,1 -k3,3r -k2,2 |
    awk -F "${TAB}" -v OFS="${TAB}" -v keep="${keep}" -v in_use="${in_use}" '
      BEGIN { n = split(in_use, ids, " "); for (i = 1; i <= n; i++) used[ids[i]] = 1 }
      seen[$2]++ { next }
      $2 in used { print "keep", $1, $2, $3, "in use"; next }
      unused[$1]++ < keep { print "keep", $1, $2, $3, "recent"; next }
      { print "remove", $1, $2, $3 }'
)
count() { awk -F "${TAB}" -v action="$1" '$1 == action { n++ } END { print n + 0 }' <<<"${plan}"; }
named=$(awk -F "${TAB}" '$1 == "remove" {
  n = split($2, part, "/"); id = $3; sub(/^sha256:/, "", id)
  printf "%s%s@%s", sep, part[n], substr(id, 1, 12); sep = " "
}' <<<"${plan}")

if [ "${dry_run}" = true ]; then
  [ -z "${plan}" ] || printf '%s\n' "${plan}"
  say "dry run: would keep $(count keep) and remove $(count remove) (${named:-none}), disk $(disk)"
  exit 0
fi

before=$(disk)
awk -F "${TAB}" '$1 == "remove" { print $3 }' <<<"${plan}" | while read -r id; do
  docker rmi -f "${id}" >/dev/null
done
say "kept $(count keep) and removed $(count remove) (${named:-none}), disk ${before} -> $(disk)"
