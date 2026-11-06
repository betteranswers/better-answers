#!/usr/bin/env bash
set -euo pipefail
if [ $# -ne 1 ]; then
  echo "usage: test-inventory <out-dir>" >&2
  exit 2
fi
root=$(git rev-parse --show-toplevel)
mkdir -p "$1"
out=$(cd "$1" && pwd)

for w in packages/core packages/schema packages/devtools apps/api apps/web; do
  name=$(basename "$w")
  : > "$out/vitest-$name.txt"
  [ -d "$root/$w" ] || continue
  (cd "$root/$w" && node ./node_modules/vitest/vitest.mjs list --json) |
    python3 -c '
import json, os, sys
for t in json.load(sys.stdin):
    print(os.path.basename(t["file"]), "::", t["name"])' | sort > "$out/vitest-$name.txt"
done

: > "$out/pytest-worker.txt"
if [ -d "$root/apps/worker" ]; then
  (cd "$root/apps/worker" && uv run --frozen pytest --collect-only -q -o addopts=) |
    grep '::' | python3 -c '
import os, sys
for line in sys.stdin:
    path, _, rest = line.rstrip("\n").partition("::")
    print(os.path.basename(path), "::", rest)' | sort > "$out/pytest-worker.txt"
fi

: > "$out/playwright-web.txt"
if [ -d "$root/apps/web" ]; then
  (cd "$root/apps/web" && npx playwright test --list) |
    grep ' › ' | sed -E 's#^ *\[[^]]*\] › ##; s#^([^:]*/)?([^/:]+):[0-9]+:[0-9]+ › #\2 :: #' | sort > "$out/playwright-web.txt"
fi

wc -l "$out"/*.txt
