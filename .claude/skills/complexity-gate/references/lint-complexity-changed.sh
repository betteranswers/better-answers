#!/usr/bin/env bash
# Cyclomatic-complexity gate, scoped to the files changed vs a base ref.
#
# `pnpm lint:complexity` (eslint over the whole repo) is an advisory
# inventory — legacy functions over the cap fail it until they're touched,
# so it cannot gate CI. THIS script is the gate: it lints only the files
# the current branch changed, so a PR fails only on complexity it
# introduced or touched.
#
# Usage: lint-complexity-changed.sh [base-ref]   (default: origin/main)
set -euo pipefail

base="${1:-origin/main}"
merge_base="$(git merge-base "$base" HEAD)"
pathspec=('*.ts' '*.tsx' '*.mts' '*.mjs')

# Diff the merge-base against the WORKING TREE, not HEAD, so a local
# pre-commit run sees the same files CI will see once they're committed;
# untracked new files come from ls-files. --diff-filter=d: skip deleted
# files (nothing to lint).
files=()
while IFS= read -r f; do
  files+=("$f")
done < <(
  {
    git diff --name-only --diff-filter=d "$merge_base" -- "${pathspec[@]}"
    git ls-files --others --exclude-standard -- "${pathspec[@]}"
  } | sort -u
)

if [ "${#files[@]}" -eq 0 ]; then
  echo "No changed lintable files vs $base."
  exit 0
fi

echo "Linting ${#files[@]} changed file(s) vs $base:"
printf '  %s\n' "${files[@]}"
# --no-warn-ignored: changed files matching eslint's ignore list (generated
# code, sandboxes) are silently skipped instead of emitting warnings.
npx eslint --no-warn-ignored "${files[@]}"
