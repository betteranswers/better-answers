#!/usr/bin/env bash
set -euo pipefail


USAGE="Usage: provision-worktree.sh <worktree-path>"
WORKTREE_ARG="${1:?$USAGE}"
[ -d "$WORKTREE_ARG" ] || { echo "Error: '$WORKTREE_ARG' does not exist." >&2; exit 1; }
WORKTREE_PATH="$(cd "$WORKTREE_ARG" && pwd -P)"
git -C "$WORKTREE_PATH" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || { echo "Error: '$WORKTREE_PATH' is not a git worktree." >&2; exit 1; }

export PATH="$HOME/Library/pnpm:$HOME/.local/bin:/opt/homebrew/bin:$PATH"
if ! command -v node >/dev/null 2>&1 && [ -d "$HOME/.nvm/versions/node" ]; then
  WANT="$(cat "$WORKTREE_PATH/.node-version" 2>/dev/null || echo 24)"
  NODE_BIN="$(ls -d "$HOME/.nvm/versions/node/v${WANT}"*/bin 2>/dev/null | sort -V | tail -1 || true)"
  [ -n "$NODE_BIN" ] && export PATH="$NODE_BIN:$PATH"
fi

echo "provision-worktree: $WORKTREE_PATH" >&2
STATUS=0

BRANCH="$(git -C "$WORKTREE_PATH" branch --show-current 2>/dev/null || true)"
if [ -z "$BRANCH" ]; then
  echo "  upstream: detached HEAD — nothing to unset" >&2
elif UPSTREAM="$(git -C "$WORKTREE_PATH" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"; then
  if git -C "$WORKTREE_PATH" branch --unset-upstream >&2 2>&1; then
    echo "  upstream: unset — $BRANCH tracked $UPSTREAM" >&2
  else
    echo "  upstream: FAILED to unset $UPSTREAM from $BRANCH — run git branch --unset-upstream by hand" >&2
    STATUS=1
  fi
else
  echo "  upstream: none — $BRANCH tracks nothing" >&2
fi

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

if command -v jcodemunch-mcp >/dev/null 2>&1; then
  START=$SECONDS
  if jcodemunch-mcp index "$WORKTREE_PATH" >&2 2>&1; then
    echo "  jcodemunch index: done in $((SECONDS - START))s" >&2
  else
    echo "  jcodemunch index: FAILED — run jcodemunch-mcp index \"$WORKTREE_PATH\" by hand" >&2
    STATUS=1
  fi
else
  echo "  jcodemunch: not on PATH — skipped; edits here register in the primary checkout's index" >&2
fi

bash "$(dirname "${BASH_SOURCE[0]}")/provision-skills.sh" "$WORKTREE_PATH" || STATUS=1

COMMON_DIR="$(git -C "$WORKTREE_PATH" rev-parse --path-format=absolute --git-common-dir)"
PRIMARY_PATH="$(cd "$(dirname "$COMMON_DIR")" && pwd -P)"
SCRATCH_LINK="$WORKTREE_PATH/.scratch"
if [ "$PRIMARY_PATH" = "$WORKTREE_PATH" ]; then
  echo "  scratch: this is the primary checkout — nothing to link" >&2
elif [ -e "$SCRATCH_LINK" ] || [ -L "$SCRATCH_LINK" ]; then
  echo "  scratch: already here — left alone" >&2
elif [ ! -d "$PRIMARY_PATH/.scratch" ]; then
  echo "  scratch: none at $PRIMARY_PATH — nothing to link" >&2
elif ln -s "$PRIMARY_PATH/.scratch" "$SCRATCH_LINK"; then
  echo "  scratch: linked to $PRIMARY_PATH/.scratch" >&2
else
  echo "  scratch: FAILED to link — run ln -s \"$PRIMARY_PATH/.scratch\" \"$SCRATCH_LINK\" by hand" >&2
  STATUS=1
fi

echo "provision-worktree: $([ $STATUS -eq 0 ] && echo ready || echo incomplete)" >&2
exit $STATUS
