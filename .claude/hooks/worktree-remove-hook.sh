#!/usr/bin/env bash
set -uo pipefail

# .claude/hooks/worktree-remove-hook.sh — Claude Code's `WorktreeRemove` hook.
#
# The cleanup half of .claude/hooks/worktree-create-hook.sh. Fires when a worktree subagent
# finishes, a `--worktree` session exits and chooses removal, or a background session
# is deleted. Claude Code passes the path the create hook returned as `.worktree_path`
# and gives this hook no decision: it can tidy, never block, and a failure is logged
# only in debug mode — so every outcome below exits 0 and says why on stderr.
#
# The rule is Claude Code's own for native worktrees: a clean worktree goes, and one
# holding work stays on disk for a person to look at. "Work" is changed or untracked
# files, or commits its upstream (or `main`, when it has none) does not have. A
# hook-created worktree carries no Claude Code marker, so the periodic sweep never
# removes it; a kept worktree is removed by hand with `git worktree remove --force`.
#
# A worktree removed here also gives up its jCodeMunch index, the one
# .claude/hooks/provision-worktree.sh gave it at creation (T-181): without that, the
# registry keeps naming a root that is no longer on disk, which is the state the owner's
# machine was found in — seven create events and no removals, the oldest naming a path
# gone for a fortnight. A jCodeMunch repository id is not derivable from its path, so it
# is read from the registry `list-repos --json` prints. Everything about that stage is
# best effort: this hook tidies and never blocks, so a machine without the tool, a path
# the registry does not know and a refused delete are each one line on stderr and an
# exit 0 like every other outcome.

INPUT="$(cat)"
WT="$(printf '%s' "$INPUT" | jq -r '.worktree_path // empty' 2>/dev/null || true)"
[ -n "$WT" ] || { echo "worktree-remove-hook: no worktree_path in input" >&2; exit 0; }
[ -d "$WT" ] || { echo "worktree-remove-hook: $WT already gone" >&2; exit 0; }
# Physically, and before the removal: the registry holds resolved roots, and the path
# cannot be resolved once the directory it names has gone.
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

# The main checkout owns the worktree list; resolve it from the shared .git directory.
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
