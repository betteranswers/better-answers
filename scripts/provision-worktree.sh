#!/usr/bin/env bash
set -euo pipefail

# scripts/provision-worktree.sh <worktree-path>
#
# Installs a fresh checkout's dependencies so an agent's first act in a worktree is
# its task, not `pnpm install`. Run by scripts/worktree-create-hook.sh for every
# worktree Claude Code creates; runnable by hand after `git worktree add`.
#
# Install, never symlink or clone from the main checkout. pnpm and uv both install by
# hard link from a global store (seconds), and both write links that are relative to
# the real tree: pnpm's workspace links (`node_modules/@better-answers/core ->
# ../../packages/core`) and uv's editable `.pth`. A `node_modules` or `.venv` shared
# with `main` would import main's `packages/core` and worker source, so a worktree's
# tests would run against code it is not editing.
#
# Nothing is copied from `.env.local`: no workspace, test or compose file reads it
# (checked 02/09/2026), and tests reach Postgres through Testcontainers. If that
# changes, copy the file here — a WorktreeCreate hook suppresses `.worktreeinclude`.

USAGE="Usage: provision-worktree.sh <worktree-path>"
WORKTREE_ARG="${1:?$USAGE}"
[ -d "$WORKTREE_ARG" ] || { echo "Error: '$WORKTREE_ARG' does not exist." >&2; exit 1; }
WORKTREE_PATH="$(cd "$WORKTREE_ARG" && pwd -P)"
git -C "$WORKTREE_PATH" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || { echo "Error: '$WORKTREE_PATH' is not a git worktree." >&2; exit 1; }

# A hook inherits the session's PATH, which is not always a login shell's. These
# are where this machine's tools live; a PATH that already has them is unchanged.
export PATH="$HOME/Library/pnpm:$HOME/.local/bin:/opt/homebrew/bin:$PATH"
if ! command -v node >/dev/null 2>&1 && [ -d "$HOME/.nvm/versions/node" ]; then
  WANT="$(cat "$WORKTREE_PATH/.node-version" 2>/dev/null || echo 24)"
  NODE_BIN="$(ls -d "$HOME/.nvm/versions/node/v${WANT}"*/bin 2>/dev/null | sort -V | tail -1 || true)"
  [ -n "$NODE_BIN" ] && export PATH="$NODE_BIN:$PATH"
fi

echo "provision-worktree: $WORKTREE_PATH" >&2
STATUS=0

# --- pnpm: the TypeScript workspaces ---
if command -v pnpm >/dev/null 2>&1; then
  START=$SECONDS
  if pnpm --dir "$WORKTREE_PATH" install --frozen-lockfile --offline >&2 2>&1 \
     || pnpm --dir "$WORKTREE_PATH" install --frozen-lockfile --prefer-offline >&2 2>&1; then
    echo "  pnpm install: done in $((SECONDS - START))s" >&2
  else
    echo "  pnpm install: FAILED — run it by hand in the worktree" >&2
    STATUS=1
  fi
else
  echo "  pnpm: not on PATH — skipped" >&2
  STATUS=1
fi

# --- uv: the Python worker ---
WORKER="$WORKTREE_PATH/apps/worker"
if [ -f "$WORKER/pyproject.toml" ]; then
  if command -v uv >/dev/null 2>&1; then
    START=$SECONDS
    if uv sync --frozen --directory "$WORKER" >&2 2>&1; then
      echo "  uv sync: done in $((SECONDS - START))s" >&2
    else
      echo "  uv sync: FAILED — run it by hand in apps/worker" >&2
      STATUS=1
    fi
  else
    echo "  uv: not on PATH — skipped" >&2
    STATUS=1
  fi
fi

echo "provision-worktree: $([ $STATUS -eq 0 ] && echo ready || echo incomplete)" >&2
exit $STATUS
