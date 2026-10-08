#!/usr/bin/env bash
set -euo pipefail

# stdout must be exactly the created directory or session startup aborts: diagnostics go to stderr.
INPUT="$(cat)"
NAME="$(printf '%s' "$INPUT" | jq -r '.name // empty' 2>/dev/null || true)"
[ -n "$NAME" ] || NAME="wt-$(date +%s)-$$"

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
DIR="$ROOT/.claude/worktrees/$NAME"
BRANCH="worktree-$NAME"

# Each creation sweeps, as nothing runs as often as worktrees pile up, off stdout so it never waits.
LOG="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" \
  && LOG="$LOG/worktree-sweep.log" || LOG=/dev/null
nohup bash "$ROOT/.claude/hooks/sweep-worktrees.sh" "$ROOT" </dev/null >"$LOG" 2>&1 &

if [ -d "$DIR" ]; then
  echo "worktree-create-hook: reopening $DIR" >&2
  echo "$DIR"
  exit 0
fi

if git -C "$ROOT" show-ref --verify --quiet "refs/heads/$BRANCH"; then
  BRANCH="$BRANCH-$(date +%s)"
fi

git -C "$ROOT" worktree add -b "$BRANCH" "$DIR" HEAD >&2

bash "$ROOT/.claude/hooks/provision-worktree.sh" "$DIR" >&2 \
  || echo "worktree-create-hook: provisioning incomplete — the worktree is usable, install by hand" >&2

echo "$DIR"
