#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >> "${STUB_STATE}/calls"
tab=$(printf '\t')
containers="${STUB_STATE}/containers"
images="${STUB_STATE}/images"

render() {
  local out=$1
  shift
  out=${out//\\t/${tab}}
  while [ $# -gt 0 ]; do
    out=${out//"{{.${1%%=*}}}"/${1#*=}}
    shift
  done
  printf '%s\n' "${out}"
}

case "$1 ${2:-}" in
  "ps --format")
    while IFS="${tab}" read -r _ _ ref state; do
      [ "${state}" != running ] || render "$3" "Image=${ref}"
    done < "${containers}"
    ;;
  "ps -aq") cut -f1 "${containers}" ;;
  "ps -q") awk -F "${tab}" '$4 == "running" { print $1 }' "${containers}" ;;
  "inspect --format")
    format=$3
    shift 3
    for wanted in "$@"; do
      image=$(awk -F "${tab}" -v name="${wanted}" '$1 == name { print $2 }' "${containers}")
      [ -n "${image}" ] || { echo "Error: No such object: ${wanted}" >&2; exit 1; }
      render "${format}" "Image=${image}"
    done
    ;;
  "image ls")
    shift 2
    full=false
    [ "$1" != --no-trunc ] || { full=true; shift; }
    [ "$1" = --format ] || { echo "stub docker: image ls without --format" >&2; exit 3; }
    while IFS="${tab}" read -r repository tag id created; do
      [ "${full}" = true ] || id=${id:7:12}
      render "$2" "Repository=${repository}" "Tag=${tag}" "ID=${id}" "CreatedAt=${created}"
    done < "${images}"
    ;;
  "rmi "*)
    id=${!#}
    references=$(awk -F "${tab}" -v id="${id}" '$3 == id' "${images}" | wc -l | tr -d ' ')
    [ "${references}" != 0 ] || { echo "Error: No such image: ${id}" >&2; exit 1; }
    [ "$2" = -f ] || [ "${references}" = 1 ] || { echo "Error: conflict: unable to delete ${id} (must be forced)" >&2; exit 1; }
    printf '%s\n' "${id}" >> "${STUB_STATE}/removed"
    awk -F "${tab}" -v id="${id}" '$3 != id' "${images}" > "${images}.next"
    mv "${images}.next" "${images}"
    ;;
  *)
    echo "stub docker: no answer for: $*" >&2
    exit 3
    ;;
esac
