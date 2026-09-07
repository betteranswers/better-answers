#!/usr/bin/env bash
set -euo pipefail

# .claude/hooks/provision-skills.sh <worktree-path>
#
# The skills stage of provisioning: gives a worktree the agent tooling a checkout cannot
# carry. Run by .claude/hooks/provision-worktree.sh after the installs; runnable by hand.
#
# `git worktree add` checks out tracked files only, and the tooling agents run on here is
# installed and ignored (ADR 0027 — third-party content is never ours to publish):
# `.agents/skills/` holds the installed skills, `.claude/skills/` a relative symlink per
# skill into it plus the plugin skills that live there directly, and `tasks/AGENTS.md`
# is `ordna skill install`'s copy of the ordna guide. Without this stage a worktree is
# offered only `.claude/skills/browser-suite/`, the one skill this repository wrote.
#
# Copied, never symlinked, from the primary checkout — the working tree beside the
# directory `git rev-parse --git-common-dir` names. Copying is safe here where it is not
# for `node_modules` or `.venv`: a skill is static markdown that resolves no path, so a
# worktree's copy reads the same whichever tree it sits in. A symlink into the primary
# would break the moment the primary's install changed, and a `.claude/skills/*` link
# is relative, so it must sit inside the tree it points within.
#
# An entry the checkout already carries is left alone — the tracked skill is never
# overwritten by the primary's copy — which is also what makes a second run a no-op.
#
# When the primary has nothing to give (a fresh clone, or the primary is this checkout),
# the skills are reinstalled from `skills-lock.json`, the tracked manifest of what this
# repository installs. `npx skills experimental_install` is the installer's own restore
# command (skills CLI, read 07/09/2026); a machine without it, or a refusal, is said
# plainly and is a non-zero exit like every other stage's failure.

USAGE="Usage: provision-skills.sh <worktree-path>"
WORKTREE_ARG="${1:?$USAGE}"
[ -d "$WORKTREE_ARG" ] || { echo "Error: '$WORKTREE_ARG' does not exist." >&2; exit 1; }
WORKTREE_PATH="$(cd "$WORKTREE_ARG" && pwd -P)"
COMMON_DIR="$(git -C "$WORKTREE_PATH" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" \
  || { echo "Error: '$WORKTREE_PATH' is not a git worktree." >&2; exit 1; }
PRIMARY_PATH="$(cd "$(dirname "$COMMON_DIR")" && pwd -P)"

# What the checkout cannot carry, as paths relative to a tree. `.claude/skills/*` is
# expanded per entry so a tracked skill under it is skipped on its own and the rest copied.
ENTRIES=(".agents" "skills-lock.json" "tasks/AGENTS.md")
if [ -d "$PRIMARY_PATH/.claude/skills" ]; then
  for entry in "$PRIMARY_PATH"/.claude/skills/*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    ENTRIES+=(".claude/skills/$(basename "$entry")")
  done
fi

STATUS=0

# --- copy: every entry the primary has and the worktree does not ---
# `-L` alongside `-e` because a dangling link exists too, and is the worktree's to keep.
COPIED=0
if [ "$PRIMARY_PATH" != "$WORKTREE_PATH" ] && [ -d "$PRIMARY_PATH/.agents/skills" ]; then
  for entry in "${ENTRIES[@]}"; do
    src="$PRIMARY_PATH/$entry"
    dst="$WORKTREE_PATH/$entry"
    { [ -e "$src" ] || [ -L "$src" ]; } || continue
    { [ -e "$dst" ] || [ -L "$dst" ]; } && continue
    mkdir -p "$(dirname "$dst")"
    # -R copies a directory whole; -P keeps a link a link rather than copying its target.
    cp -RP "$src" "$dst"
    COPIED=$((COPIED + 1))
  done
  if [ "$COPIED" -gt 0 ]; then
    echo "  skills: copied $COPIED entries from $PRIMARY_PATH" >&2
  else
    echo "  skills: nothing to copy — the worktree already carries them" >&2
  fi
elif [ -d "$WORKTREE_PATH/.agents/skills" ]; then
  echo "  skills: nothing to copy — the worktree already carries them" >&2
else
  # --- fallback: the primary has no skills, so reinstall from the tracked manifest ---
  if [ ! -f "$WORKTREE_PATH/skills-lock.json" ]; then
    echo "  skills: FAILED — the primary checkout ($PRIMARY_PATH) has no installed skills and there is no skills-lock.json to reinstall from" >&2
    exit 1
  fi
  echo "  skills: the primary checkout has no installed skills — reinstalling from skills-lock.json" >&2
  if command -v npx >/dev/null 2>&1 \
     && (cd "$WORKTREE_PATH" && npx -y skills experimental_install >&2 2>&1); then
    echo "  skills: reinstalled from skills-lock.json" >&2
  else
    echo "  skills: FAILED — could not reinstall from skills-lock.json (npx skills experimental_install); run it by hand in the worktree" >&2
    exit 1
  fi
fi

# --- verify: every .claude/skills link resolves, inside the worktree ---
BROKEN=0
for link in "$WORKTREE_PATH"/.claude/skills/*; do
  [ -L "$link" ] || continue
  name=".claude/skills/$(basename "$link")"
  target="$(readlink "$link")"
  # Resolve physically from the link's own directory, the way the reader of the link will.
  resolved="$(cd "$(dirname "$link")" && cd -P "$target" 2>/dev/null && pwd -P || true)"
  if [ -z "$resolved" ]; then
    echo "  skills: $name -> $target does not resolve" >&2
    BROKEN=$((BROKEN + 1))
  elif [ "${resolved#"$WORKTREE_PATH"/}" = "$resolved" ]; then
    echo "  skills: $name -> $target resolves outside the worktree, at $resolved" >&2
    BROKEN=$((BROKEN + 1))
  fi
done
if [ "$BROKEN" -gt 0 ]; then
  echo "  skills: FAILED — $BROKEN link(s) under .claude/skills do not resolve inside the worktree" >&2
  STATUS=1
else
  echo "  skills: every .claude/skills link resolves inside the worktree" >&2
fi

exit $STATUS
