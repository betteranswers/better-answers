#!/usr/bin/env bash
set -euo pipefail

# stdout must be exactly the created directory or session startup aborts: diagnostics go to stderr.
INPUT="$(cat)"
NAME="$(printf '%s' "$INPUT" | jq -r '.name // empty' 2>/dev/null || true)"
[ -n "$NAME" ] || NAME="wt-$(date +%s)-$$"

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
DIR="$ROOT/.claude/worktrees/$NAME"
BRANCH="worktree-$NAME"

if [ -d "$DIR" ]; then
  echo "worktree-create-hook: reopening $DIR" >&2
  echo "$DIR"
  exit 0
fi

if git -C "$ROOT" show-ref --verify --quiet "refs/heads/$BRANCH"; then
  BRANCH="$BRANCH-$(date +%s)"
fi

# CLAUDE_PROJECT_DIR names the main checkout even from a linked worktree, so only the input's cwd
# tells a delegate, which builds on its session's branch, from independent work, which wants main.
FROM="$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)"
[ -n "$FROM" ] || {
  echo "worktree-create-hook: the input names no cwd, so basing as for the main checkout" >&2
  FROM="$ROOT"
}
if [ "$(git -C "$FROM" rev-parse --path-format=absolute --git-dir 2>/dev/null)" \
  != "$(git -C "$FROM" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" ]; then
  BASE="$(git -C "$FROM" rev-parse HEAD)"
elif GIT_TERMINAL_PROMPT=0 git -C "$ROOT" fetch --quiet origin main >&2; then
  BASE=origin/main
else
  echo "worktree-create-hook: could not fetch origin, so basing on the local main" >&2
  BASE=main
fi

git -C "$ROOT" worktree add -b "$BRANCH" "$DIR" "$BASE" >&2

# Each creation sweeps, as nothing runs as often as worktrees pile up, off stdout so it never waits.
# Not before the add: the sweep fetches main too, and the two fetches would race for the ref.
LOG="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" \
  && LOG="$LOG/worktree-sweep.log" || LOG=/dev/null
nohup bash "$ROOT/.claude/hooks/sweep-worktrees.sh" "$ROOT" </dev/null >"$LOG" 2>&1 &

bash "$ROOT/.claude/hooks/provision-worktree.sh" "$DIR" >&2 \
  || echo "worktree-create-hook: provisioning incomplete — the worktree is usable, install by hand" >&2

echo "$DIR"
