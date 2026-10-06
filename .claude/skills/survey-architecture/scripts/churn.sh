#!/usr/bin/env bash
# Usage: churn.sh [days] [max-areas] [ref]
set -euo pipefail
days="${1:-30}"; max="${2:-4}"; ref="${3:-HEAD}"
git log "$ref" --since="$days.days" --no-merges --format='@%h' --name-only -- apps packages |
awk -v max="$max" '
function area(p,  a, n) {
  n = split(p, a, "/")
  if (a[3] != "src") return ""
  if (a[1] == "apps" && (a[2] == "worker" || (a[2] == "web" && a[4] == "features")) && n > 5) return a[1] "/" a[2] "/" a[3] "/" a[4] "/" a[5]
  if (n > 4) return a[1] "/" a[2] "/" a[3] "/" a[4]
  return a[1] "/" a[2] "/" a[3]
}
function flush(  k, c) {
  c = 0
  for (k in seen) c++
  if (c > max) wide++
  else for (k in seen) churn[k]++
  delete seen
}
/^@/ { flush(); next }
NF { x = area($0); if (x != "") seen[x] = 1 }
END { flush(); for (k in churn) printf "%d\t%s\n", churn[k], k; printf "# %d commits touching more than %d areas left out\n", wide, max }
' | sort -rn
