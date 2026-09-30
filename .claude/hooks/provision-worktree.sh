#!/usr/bin/env bash
set -euo pipefail

USAGE="Usage: provision-worktree.sh <worktree-path>"
WORKTREE_ARG="${1:?$USAGE}"
[ -d "$WORKTREE_ARG" ] || { echo "Error: '$WORKTREE_ARG' does not exist." >&2; exit 1; }
WORKTREE_PATH="$(cd "$WORKTREE_ARG" && pwd -P)"
git -C "$WORKTREE_PATH" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || { echo "Error: '$WORKTREE_PATH' is not a git worktree." >&2; exit 1; }

# A hook inherits the session's PATH, which is not always a login shell's. A PATH that
export PATH="$HOME/Library/pnpm:$HOME/.local/bin:/opt/homebrew/bin:$PATH"
if ! command -v node >/dev/null 2>&1 && [ -d "$HOME/.nvm/versions/node" ]; then
  WANT="$(cat "$WORKTREE_PATH/.node-version" 2>/dev/null || echo 24)"
  NODE_BIN="$(find "$HOME/.nvm/versions/node" -mindepth 2 -maxdepth 2 -type d -path "*/v${WANT}*/bin" 2>/dev/null | sort -V | tail -1 || true)"
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

# Installed, never shared with the primary checkout: both tools write links relative to the
# real tree, so a shared tree would import the wrong workspace.
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

# An index of its own from creation, or every edit here registers in the primary checkout's
# index under a path another session reads.
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

# jDocMunch shares one index across a checkout's worktrees unless asked for a branch-local one,
# and only its Python API asks. The index takes the worktree's folder name, which is how its
# edit hook finds it; without one, a doc edit here lands in the primary checkout's index.
if command -v jdocmunch-mcp >/dev/null 2>&1; then
  START=$SECONDS
  JDOC_PYTHON="$(dirname "$(readlink -f "$(command -v jdocmunch-mcp)")")/python3"
  if "$JDOC_PYTHON" - "$WORKTREE_PATH" >&2 2>&1 <<'PY'
import sys
from jdocmunch_mcp.tools.index_local import index_local
result = index_local(path=sys.argv[1], use_ai_summaries=False, use_embeddings=False, worktree_mode="branch_local")
sys.exit(0 if result.get("success") else 1)
PY
  then
    echo "  jdocmunch index: done in $((SECONDS - START))s" >&2
  else
    echo "  jdocmunch index: FAILED — doc edits here land in the primary checkout's index" >&2
    STATUS=1
  fi
else
  echo "  jdocmunch: not on PATH — skipped; doc edits here land in the primary checkout's index" >&2
fi

bash "$(dirname "${BASH_SOURCE[0]}")/provision-skills.sh" "$WORKTREE_PATH" || STATUS=1

COMMON_DIR="$(git -C "$WORKTREE_PATH" rev-parse --path-format=absolute --git-common-dir)"
PRIMARY_PATH="$(cd "$(dirname "$COMMON_DIR")" && pwd -P)"

link_from_primary() {
  local label="$1" dir="$2" link="$WORKTREE_PATH/$2"
  if [ "$PRIMARY_PATH" = "$WORKTREE_PATH" ]; then
    echo "  $label: this is the primary checkout — nothing to link" >&2
  # `-L` as well, so a link whose target has gone is left alone rather than failed over by `ln`.
  elif [ -e "$link" ] || [ -L "$link" ]; then
    echo "  $label: already here — left alone" >&2
  elif [ ! -d "$PRIMARY_PATH/$dir" ]; then
    echo "  $label: none at $PRIMARY_PATH — nothing to link" >&2
  elif ln -s "$PRIMARY_PATH/$dir" "$link"; then
    echo "  $label: linked to $PRIMARY_PATH/$dir" >&2
  else
    echo "  $label: FAILED to link — run ln -s \"$PRIMARY_PATH/$dir\" \"$link\" by hand" >&2
    STATUS=1
  fi
}
link_from_primary scratch .scratch
link_from_primary planning .planning

# Relative, so it resolves in the primary checkout and, through the `.planning` link, here.
PERSONAS_LINK="$WORKTREE_PATH/docs/personas"
if [ -e "$PERSONAS_LINK" ] || [ -L "$PERSONAS_LINK" ]; then
  echo "  personas: already here — left alone" >&2
elif [ ! -d "$WORKTREE_PATH/.planning/personas" ]; then
  echo "  personas: no .planning/personas — nothing to link" >&2
elif mkdir -p "$WORKTREE_PATH/docs" && ln -s ../.planning/personas "$PERSONAS_LINK"; then
  echo "  personas: linked to .planning/personas" >&2
else
  echo "  personas: FAILED to link — run ln -s ../.planning/personas \"$PERSONAS_LINK\" by hand" >&2
  STATUS=1
fi

echo "provision-worktree: $([ $STATUS -eq 0 ] && echo ready || echo incomplete)" >&2
exit $STATUS
