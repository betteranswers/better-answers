#!/usr/bin/env bash
set -uo pipefail

# This hook may tidy and never block, so every outcome below exits 0 and says why on stderr.
INPUT="$(cat)"
WT="$(printf '%s' "$INPUT" | jq -r '.worktree_path // empty' 2>/dev/null || true)"
[ -n "$WT" ] || { echo "worktree-remove-hook: no worktree_path in input" >&2; exit 0; }
[ -d "$WT" ] || { echo "worktree-remove-hook: $WT already gone" >&2; exit 0; }
# Physically, and before the removal: a path cannot be resolved once its directory has gone.
WT_REAL="$(cd "$WT" && pwd -P)"

keep() {
  echo "worktree-remove-hook: keeping $WT — $1" >&2
  exit 0
}

drop_index() {
  command -v jcodemunch-mcp >/dev/null 2>&1 || return 0
  REPO="$(jcodemunch-mcp list-repos --json 2>/dev/null \
    | jq -r --arg root "$WT_REAL" 'map(select(.source_root == $root)) | first | .repo_id // empty' \
      2>/dev/null || true)"
  if [ -z "$REPO" ] || [ "$REPO" = "null" ]; then
    echo "worktree-remove-hook: jcodemunch: no index named $WT_REAL" >&2
  elif jcodemunch-mcp delete-index "$REPO" >/dev/null 2>&1; then
    echo "worktree-remove-hook: jcodemunch: dropped the index $REPO" >&2
  else
    echo "worktree-remove-hook: jcodemunch: could not drop the index $REPO — run jcodemunch-mcp delete-index $REPO by hand" >&2
  fi
}

git -C "$WT" rev-parse --is-inside-work-tree >/dev/null 2>&1 || keep "not a git worktree"

if [ -n "$(git -C "$WT" status --porcelain 2>/dev/null)" ]; then
  keep "it has changed or untracked files"
fi

BRANCH="$(git -C "$WT" branch --show-current 2>/dev/null || true)"
if git -C "$WT" rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  AHEAD="$(git -C "$WT" rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)"
  AGAINST="its upstream"
else
  AHEAD="$(git -C "$WT" rev-list --count 'main..HEAD' 2>/dev/null || echo 0)"
  AGAINST="main"
fi
[ "$AHEAD" -eq 0 ] || keep "it has $AHEAD commit(s) $AGAINST does not have (branch $BRANCH)"

# The main checkout owns the worktree list; resolve it from the shared `.git` directory.
COMMON="$(git -C "$WT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
ROOT="$(dirname "$COMMON")"

if git -C "$ROOT" worktree remove "$WT" >&2 2>&1; then
  echo "worktree-remove-hook: removed $WT" >&2
  drop_index
  if [ -n "$BRANCH" ] && git -C "$ROOT" branch -d "$BRANCH" >/dev/null 2>&1; then
    echo "worktree-remove-hook: deleted branch $BRANCH" >&2
  fi
else
  keep "git worktree remove refused (locked, or held by a running agent)"
fi
