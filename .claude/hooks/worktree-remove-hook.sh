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

INPUT="$(cat)"
WT="$(printf '%s' "$INPUT" | jq -r '.worktree_path // empty' 2>/dev/null || true)"
[ -n "$WT" ] || { echo "worktree-remove-hook: no worktree_path in input" >&2; exit 0; }
[ -d "$WT" ] || { echo "worktree-remove-hook: $WT already gone" >&2; exit 0; }

keep() {
  echo "worktree-remove-hook: keeping $WT — $1" >&2
  exit 0
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
  if [ -n "$BRANCH" ] && git -C "$ROOT" branch -d "$BRANCH" >/dev/null 2>&1; then
    echo "worktree-remove-hook: deleted branch $BRANCH" >&2
  fi
else
  keep "git worktree remove refused (locked, or held by a running agent)"
fi
