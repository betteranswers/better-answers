#!/usr/bin/env bash
set -euo pipefail

# The desktop client starts a hook with launchd's bare PATH.
PATH="$PATH:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin"

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

# --no-track: with origin/main as upstream, a bare pull merges main and, under push.default=upstream, a bare push writes to it.
git -C "$ROOT" worktree add --no-track -b "$BRANCH" "$DIR" "$BASE" >&2

# Give the worktree an index of its own, or every edit here registers in the main checkout's index.
REAL="$(cd "$DIR" && pwd -P)"
if command -v jcodemunch-mcp >/dev/null 2>&1; then
  jcodemunch-mcp index "$REAL" >/dev/null \
    || echo "worktree-create-hook: jcodemunch index FAILED — edits here register in the main checkout's index" >&2
else
  echo "worktree-create-hook: jcodemunch not on PATH — edits here register in the main checkout's index" >&2
fi

# jDocMunch's CLI lacks branch-local mode, so call its Python API. Leave the index unnamed: its edit
# hook finds it by folder name.
if command -v jdocmunch-mcp >/dev/null 2>&1; then
  JDOC_PYTHON="$(dirname "$(readlink -f "$(command -v jdocmunch-mcp)")")/python3"
  if ! "$JDOC_PYTHON" - "$REAL" >/dev/null <<'PY'
import sys
from jdocmunch_mcp.tools.index_local import index_local
result = index_local(path=sys.argv[1], use_ai_summaries=False, use_embeddings=False, worktree_mode="branch_local")
sys.exit(0 if result.get("success") else 1)
PY
  then
    echo "worktree-create-hook: jdocmunch index FAILED — doc edits here land in the main checkout's index" >&2
  fi
else
  echo "worktree-create-hook: jdocmunch not on PATH — doc edits here land in the main checkout's index" >&2
fi

echo "$DIR"
