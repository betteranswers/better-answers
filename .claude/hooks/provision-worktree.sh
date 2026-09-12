#!/usr/bin/env bash
set -euo pipefail

# .claude/hooks/provision-worktree.sh <worktree-path>
#
# Installs a fresh checkout's dependencies and the agent tooling a checkout cannot carry,
# so an agent's first act in a worktree is its task, not `pnpm install`. Run by
# .claude/hooks/worktree-create-hook.sh for every worktree Claude Code creates; runnable
# by hand after `git worktree add`, which fires no hook.
#
# Five stages, each reporting on its own line and none stopping the next:
#   upstream         — the branch tracks nothing until someone says so
#   pnpm install     — the TypeScript workspaces
#   uv sync          — the Python worker
#   jcodemunch index — the worktree as a jCodeMunch root of its own
#   skills           — .claude/hooks/provision-skills.sh: the installed, ignored agent
#                      tooling (`.agents/`, `.claude/skills/*`, each workspace's
#                      `.claude/skills/*`, `tasks/AGENTS.md`)
#
# `git worktree add -b <branch> <path> origin/main` sets the new branch to track
# `origin/main`, silently: a bare `git push` from the worktree then aims at `main`, and
# the remove hook measures "work" against that upstream rather than against `main`.
# `push.default` is unset here, so git's `simple` refuses the mismatched push — the
# tracking is surprising rather than harmful — and the stage unsets it so the branch's
# upstream is set on its first `git push -u`, by the session that means it. Here and
# not in the create hook, because a worktree made by hand fires no hook and runs this.
#
# `node_modules` and `.venv` are installed, never symlinked or copied from the primary
# checkout. pnpm and uv both install by hard link from a global store (seconds), and
# both write links that are relative to the real tree: pnpm's workspace links
# (`node_modules/@better-answers/core -> ../../packages/core`) and uv's editable
# `.pth`. A `node_modules` or `.venv` shared with `main` would import main's
# `packages/core` and worker source, so a worktree's tests would run against code it
# is not editing. That rule is about path resolution and does not reach the skills,
# which are static markdown; provision-skills.sh copies those, and says why there.
#
# The worktree is given a jCodeMunch index of its own here, rather than at whatever edit
# happens first, because jCodeMunch resolves an edited file into the nearest containing
# indexed root: until the worktree is one, every file an agent edits in it is registered
# into the *primary checkout's* index under `.claude/worktrees/…`, where a later search
# answers out of a ticket that is not the reader's, or out of a worktree no longer on disk
# (T-146, T-181). The verb is the CLI's own `index <path>`; `index_folder` is the MCP
# tool's name and is not something a script can call. A machine without jCodeMunch is not
# a broken worktree, so that case says what it costs and leaves STATUS alone — the shape
# `actionlint` has in lefthook.yml — while an index that was attempted and failed is a
# stage failure like any other. .claude/hooks/worktree-remove-hook.sh drops the index
# again when it removes the worktree.
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

# --- upstream: the worktree's branch tracks nothing until someone says so ---
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

# --- jcodemunch: the worktree is a root of its own from its first edit ---
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

# --- skills: the installed agent tooling, copied from the primary checkout ---
bash "$(dirname "${BASH_SOURCE[0]}")/provision-skills.sh" "$WORKTREE_PATH" || STATUS=1

echo "provision-worktree: $([ $STATUS -eq 0 ] && echo ready || echo incomplete)" >&2
exit $STATUS
