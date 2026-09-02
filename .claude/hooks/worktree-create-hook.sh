#!/usr/bin/env bash
set -euo pipefail

# .claude/hooks/worktree-create-hook.sh — Claude Code's `WorktreeCreate` hook.
#
# Replaces native worktree creation so every worktree Claude Code makes — an
# `Agent(isolation: "worktree")` fork, `claude --worktree`, a desktop parallel
# session — is provisioned before the agent's first turn (.claude/hooks/provision-worktree.sh).
#
# Hook contract (https://code.claude.com/docs/en/worktrees, read 02/09/2026): JSON on
# stdin carrying `.name`; stdout must be EXACTLY the created directory; a non-path on
# stdout aborts session startup. Every diagnostic below therefore goes to stderr.
#
# Layout stays native — `.claude/worktrees/<name>` on branch `worktree-<name>` — so
# `.gitignore`, oxlint's and oxfmt's ignore patterns keep working unchanged. The
# branch starts from the checkout's HEAD: in this repo `main` is pushed before any
# fork, and a fork briefed to work from its worktree HEAD must see what the session
# sees. A hook-created worktree carries no Claude Code marker, so the periodic sweep
# leaves it alone; .claude/hooks/worktree-remove-hook.sh and `git worktree remove` are the
# two ways it goes.

INPUT="$(cat)"
NAME="$(printf '%s' "$INPUT" | jq -r '.name // empty' 2>/dev/null || true)"
[ -n "$NAME" ] || NAME="wt-$(date +%s)-$$"

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
DIR="$ROOT/.claude/worktrees/$NAME"
BRANCH="worktree-$NAME"

# Reopen, never recreate: a name that already has a directory is a returning session.
if [ -d "$DIR" ]; then
  echo "worktree-create-hook: reopening $DIR" >&2
  echo "$DIR"
  exit 0
fi

# A branch left behind by a crashed session is parked, not an error.
if git -C "$ROOT" show-ref --verify --quiet "refs/heads/$BRANCH"; then
  BRANCH="$BRANCH-$(date +%s)"
fi

git -C "$ROOT" worktree add -b "$BRANCH" "$DIR" HEAD >&2

bash "$ROOT/.claude/hooks/provision-worktree.sh" "$DIR" >&2 \
  || echo "worktree-create-hook: provisioning incomplete — the worktree is usable, install by hand" >&2

echo "$DIR"
