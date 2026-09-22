#!/usr/bin/env bash
set -euo pipefail

# .claude/hooks/provision-skills.sh <worktree-path>
#
# The skills stage of provisioning: gives a worktree the agent tooling a checkout cannot
# carry. Run by .claude/hooks/provision-worktree.sh after the installs; runnable by hand.
#
SKILLS_CLI="skills@1.5.24"

USAGE="Usage: provision-skills.sh <worktree-path>"
WORKTREE_ARG="${1:?$USAGE}"
[ -d "$WORKTREE_ARG" ] || { echo "Error: '$WORKTREE_ARG' does not exist." >&2; exit 1; }
WORKTREE_PATH="$(cd "$WORKTREE_ARG" && pwd -P)"
COMMON_DIR="$(git -C "$WORKTREE_PATH" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" \
  || { echo "Error: '$WORKTREE_PATH' is not a git worktree." >&2; exit 1; }
PRIMARY_PATH="$(cd "$(dirname "$COMMON_DIR")" && pwd -P)"

say() { echo "  skills: $*" >&2; }
# A path that is there — including a dangling link, which `-e` alone would miss.
present() { [ -e "$1" ] || [ -L "$1" ]; }
has_entries() { [ -d "$1" ] && [ -n "$(ls -A "$1" 2>/dev/null)" ]; }
# Every `.claude/skills` directory under a tree, relative to it: the root's at depth two
# and a workspace's at depth four. The worktrees, the installs and the dependency trees
# are pruned rather than merely excluded, so a large `node_modules` is not walked.
skill_dirs() {
  (
    cd "$1" && find . -maxdepth 4 \
      \( -path './.claude/worktrees' -o -path './.agents' -o -name node_modules -o -name .venv -o -name .git \) -prune \
      -o -type d -path '*/.claude/skills' -print \
      | sed 's|^\./||' | sort
  )
}

STATUS=0

# --- copy: every entry the primary has and the worktree does not ---
if [ "$PRIMARY_PATH" != "$WORKTREE_PATH" ]; then
  ENTRIES=("skills-lock.json")
  for entry in "$PRIMARY_PATH"/.agents/skills/*; do
    present "$entry" && ENTRIES+=(".agents/skills/$(basename "$entry")")
  done
  while IFS= read -r dir; do
    for entry in "$PRIMARY_PATH/$dir"/*; do
      present "$entry" && ENTRIES+=("$dir/$(basename "$entry")")
    done
  done < <(skill_dirs "$PRIMARY_PATH")
  COPIED=0
  for entry in "${ENTRIES[@]}"; do
    src="$PRIMARY_PATH/$entry"
    dst="$WORKTREE_PATH/$entry"
    present "$src" || continue
    present "$dst" && continue
    mkdir -p "$(dirname "$dst")"
    # -R copies a directory whole; -P keeps a link a link rather than copying its target.
    cp -RP "$src" "$dst"
    COPIED=$((COPIED + 1))
  done
  if [ "$COPIED" -gt 0 ]; then
    say "copied $COPIED entries from $PRIMARY_PATH"
  else
    say "nothing to copy from $PRIMARY_PATH"
  fi
fi

# --- reinstall: a worktree with no skills after the copy is restored from the manifest ---
if ! has_entries "$WORKTREE_PATH/.agents/skills"; then
  if [ ! -f "$WORKTREE_PATH/skills-lock.json" ]; then
    say "FAILED — no installed skills to copy from $PRIMARY_PATH, and no skills-lock.json to reinstall from"
    exit 1
  fi
  say "no installed skills to copy — reinstalling from skills-lock.json"
  if command -v npx >/dev/null 2>&1 \
     && (cd "$WORKTREE_PATH" && npx -y "$SKILLS_CLI" experimental_install >&2) \
     && has_entries "$WORKTREE_PATH/.agents/skills"; then
    say "reinstalled from skills-lock.json"
  else
    say "FAILED — could not reinstall from skills-lock.json (npx $SKILLS_CLI experimental_install left .agents/skills empty); run it by hand in the worktree"
    exit 1
  fi
fi

# --- verify: every skill link, the root's and each workspace's, resolves inside the worktree ---
LINKS=0
BROKEN=0
while IFS= read -r dir; do
  for link in "$WORKTREE_PATH/$dir"/*; do
    [ -L "$link" ] || continue
    LINKS=$((LINKS + 1))
    name="$dir/$(basename "$link")"
    target="$(readlink "$link")"
    # Resolved physically from the link's own directory, the way a reader of the link will;
    # the target's parent is entered rather than the target, so a link to a file resolves too.
    parent="$(cd "$(dirname "$link")" && cd -P "$(dirname "$target")" 2>/dev/null && pwd -P || true)"
    resolved="$parent/$(basename "$target")"
    if [ -z "$parent" ] || ! [ -e "$resolved" ]; then
      say "$name -> $target does not resolve"
      BROKEN=$((BROKEN + 1))
      continue
    fi
    [ -d "$resolved" ] && resolved="$(cd -P "$resolved" && pwd -P)"
    if [ "${resolved#"$WORKTREE_PATH"/}" = "$resolved" ]; then
      say "$name -> $target resolves outside the worktree, at $resolved"
      BROKEN=$((BROKEN + 1))
    fi
  done
done < <(skill_dirs "$WORKTREE_PATH")
if [ "$BROKEN" -gt 0 ]; then
  say "FAILED — $BROKEN of $LINKS skill links do not resolve inside the worktree"
  STATUS=1
elif [ "$LINKS" -gt 0 ]; then
  say "all $LINKS skill links resolve inside the worktree"
else
  say "no skill links to verify"
fi

exit $STATUS
