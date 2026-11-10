#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob
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
watchdog=

# Each listing runs in its own process group, so a signal to this script reaches every tool.
set -m
cleanup() {
  for pid in ${pids[@]+"${pids[@]}"} $watchdog; do kill -TERM -- "-$pid" 2>/dev/null || true; done
  rm -rf "$work"
}
trap cleanup EXIT
trap 'trap "" TERM INT; exit 143' TERM INT

# A caller killed outright cannot stop the listings, so they stop when it is gone.
caller=$PPID
(while kill -0 "$caller" 2>/dev/null; do sleep 1; done; kill -TERM $$) &
watchdog=$!

# Test modules run at import, so the listing keeps what they touch inside $work. They write temp
# folders under TMPDIR, and the image probes ask `docker info`, which this `docker` answers "down".
mkdir -p "$work/tmp" "$work/bin"
printf '#!/bin/sh\nexit 1\n' > "$work/bin/docker"
chmod +x "$work/bin/docker"
export TMPDIR="$work/tmp" PATH="$work/bin:$PATH" PYTHONDONTWRITEBYTECODE=1

json_string() {
  python3 -c 'import json, sys; print(json.dumps(sys.argv[1]))' "$1"
}

# Vitest collects a file by running it, so a title built at run time is the title that runs. A
# name filter that matches nothing lists every case, skipped and todo ones too, and runs none. The
# generated config drops globalSetup, which starts Postgres and the object store for a test run.
vitest_titles() {
  local config=$1 key=$2 scratch="$work/$2"
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

# The worker's own source comes first on the path, so a copy of the tree that shares the .venv
# imports its own source rather than the source the .venv was installed from.
pytest_titles() {
  (cd "$root/apps/worker" && { [ -e .venv ] || uv sync --frozen --quiet; } &&
    PYTHONPATH=src .venv/bin/python -m pytest --collect-only -q -o addopts= -p no:cacheprovider) |
    grep '::' | python3 -c '
import os, sys
for line in sys.stdin:
    path, _, rest = line.rstrip("\n").partition("::")
    print(os.path.basename(path), "::", rest)' | sort > "$out/pytest-worker.txt"
}

playwright_titles() {
  (cd "$root/apps/web" && node ./node_modules/@playwright/test/cli.js test --list) |
    grep ' › ' | sed -E 's#^ *\[[^]]*\] › ##; s#^([^:]*/)?([^/:]+):[0-9]+:[0-9]+ › #\2 :: #' | sort > "$out/playwright-web.txt"
}

start() {
  local name=$1
  shift
  "$@" > "$work/$name.log" 2>&1 < /dev/null &
  names+=("$name")
  pids+=("$!")
}

workspaces=()
for config in "$root"/apps/*/vitest*.config.ts "$root"/packages/*/vitest*.config.ts; do
  case $config in *.stryker.config.ts) continue ;; esac
  name=$(basename "$(dirname "$config")")
  variant=$(basename "$config" .config.ts)
  case " ${workspaces[*]-} " in
    *" $name "*) ;;
    *) workspaces+=("$name") && : > "$out/vitest-$name.txt" ;;
  esac
  start "vitest-$name-$variant" vitest_titles "$config" "$name--$variant"
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

for name in ${workspaces[@]+"${workspaces[@]}"}; do
  sort "$work/$name"--*.titles > "$out/vitest-$name.txt"
done

wc -l "$out"/*.txt
