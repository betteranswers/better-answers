#!/usr/bin/env bash
set -euo pipefail
if [ $# -ne 1 ]; then
  echo "usage: test-inventory <out-dir>" >&2
  exit 2
fi
root=$(git rev-parse --show-toplevel)
mkdir -p "$1"
out=$(cd "$1" && pwd)
work=$(mktemp -d)
names=()
pids=()

# Each listing runs in its own process group, so a signal to this script reaches every tool.
set -m
cleanup() {
  for pid in ${pids[@]+"${pids[@]}"}; do kill -TERM -- "-$pid" 2>/dev/null || true; done
  rm -rf "$work"
}
trap cleanup EXIT
trap 'exit 143' TERM INT

json_string() {
  python3 -c 'import json, sys; print(json.dumps(sys.argv[1]))' "$1"
}

# Vitest collects a file by running it, so a title built at run time is the title that runs. A
# name filter that matches nothing lists every case, skipped and todo ones too, and runs none. The
# generated config drops globalSetup, which starts Postgres and the object store for a test run.
vitest_titles() {
  local config=$1 key=$2 scratch="$work/$2"
  [ -f "$config" ] || { echo "$config is missing" >&2; return 1; }
  mkdir -p "$scratch"
  {
    printf 'import base from %s;\n' "$(json_string "$config")"
    cat <<'CONFIG'

if (typeof base !== "object" || base === null) {
  throw new Error("the config does not export a config object");
}
export default { ...base, test: { ...base.test, globalSetup: [] } };
CONFIG
  } > "$scratch/vitest.config.mjs"
  (cd "$(dirname "$config")" && node ./node_modules/vitest/vitest.mjs run --root . \
    --config "$scratch/vitest.config.mjs" --reporter=json --outputFile="$scratch/titles.json" \
    --passWithNoTests -t '(?!)')
  python3 -c '
import json, os, sys
for file in json.load(open(sys.argv[1]))["testResults"]:
    for case in file["assertionResults"]:
        print(os.path.basename(file["name"]), "::", " > ".join(case["ancestorTitles"] + [case["title"]]))
' "$scratch/titles.json" > "$work/$key.titles"
}

pytest_titles() {
  (cd "$root/apps/worker" && uv run --frozen pytest --collect-only -q -o addopts=) |
    grep '::' | python3 -c '
import os, sys
for line in sys.stdin:
    path, _, rest = line.rstrip("\n").partition("::")
    print(os.path.basename(path), "::", rest)' | sort > "$out/pytest-worker.txt"
}

playwright_titles() {
  (cd "$root/apps/web" && npx playwright test --list) |
    grep ' › ' | sed -E 's#^ *\[[^]]*\] › ##; s#^([^:]*/)?([^/:]+):[0-9]+:[0-9]+ › #\2 :: #' | sort > "$out/playwright-web.txt"
}

start() {
  local name=$1
  shift
  "$@" > "$work/$name.log" 2>&1 < /dev/null &
  names+=("$name")
  pids+=("$!")
}

workspaces=(packages/core packages/schema packages/devtools apps/api apps/web)
for w in "${workspaces[@]}"; do
  name=$(basename "$w")
  : > "$out/vitest-$name.txt"
  [ -d "$root/$w" ] || continue
  start "vitest-$name" vitest_titles "$root/$w/vitest.config.ts" "$name--default"
  for config in "$root/$w"/vitest.*.config.ts; do
    [ -f "$config" ] || continue
    case $config in *.stryker.config.ts) continue ;; esac
    variant=$(basename "$config" .config.ts)
    variant=${variant#vitest.}
    start "vitest-$name-$variant" vitest_titles "$config" "$name--$variant"
  done
done

: > "$out/pytest-worker.txt"
if [ -d "$root/apps/worker" ]; then start pytest-worker pytest_titles; fi

: > "$out/playwright-web.txt"
if [ -d "$root/apps/web" ]; then start playwright-web playwright_titles; fi

failed=0
for i in "${!pids[@]}"; do
  if ! wait "${pids[$i]}"; then
    failed=1
    echo "test-inventory: ${names[$i]} failed" >&2
    tail -n 20 "$work/${names[$i]}.log" >&2
  fi
done
[ "$failed" -eq 0 ] || exit 1

for w in "${workspaces[@]}"; do
  name=$(basename "$w")
  if compgen -G "$work/$name--*.titles" > /dev/null; then
    sort "$work/$name"--*.titles > "$out/vitest-$name.txt"
  fi
done

wc -l "$out"/*.txt
