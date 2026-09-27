#!/usr/bin/env bash
set -uo pipefail

# This hook may tidy and never block, so every outcome below exits 0 and says why on stderr.
SAY_AS=worktree-remove-hook
. "$(dirname "${BASH_SOURCE[0]}")/worktree-lib.sh"

INPUT="$(cat)"
WT="$(printf '%s' "$INPUT" | jq -r '.worktree_path // empty' 2>/dev/null || true)"
[ -n "$WT" ] || { say "no worktree_path in input"; exit 0; }
[ -d "$WT" ] || { say "$WT already gone"; exit 0; }

keep() {
  say "keeping $WT — $1"
  exit 0
}

on_main() {
  git -C "$WT" merge-base --is-ancestor "$1" origin/main 2>/dev/null \
    || git -C "$WT" merge-base --is-ancestor "$1" main 2>/dev/null
}

# The main checkout's `main` is rarely pulled, so a merge may show only once origin/main is fetched.
holds_only_merged_work() {
  local head
  head="$(git -C "$WT" rev-parse HEAD 2>/dev/null)" || return 1
  on_main "$head" && return 0
  git -C "$WT" fetch --quiet origin main >/dev/null 2>&1
  on_main "$head" || [ -n "$(pr_merged_at "$WT" "$head")" ]
}

git -C "$WT" rev-parse --is-inside-work-tree >/dev/null 2>&1 || keep "not a git worktree"
is_clean "$WT" || keep "it has changed or untracked files"

BRANCH="$(git -C "$WT" branch --show-current 2>/dev/null || true)"
holds_only_merged_work \
  || keep "it has commits origin/main lacks and no merged pull request (branch $BRANCH)"

# The main checkout owns the worktree list; resolve it from the shared `.git` directory.
COMMON="$(git -C "$WT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
remove_worktree "$(dirname "$COMMON")" "$WT" "$BRANCH" \
  || keep "git worktree remove refused (locked, or held by a running agent)"
