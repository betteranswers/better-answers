#!/usr/bin/env bash
set -euo pipefail

SKILLS_CLI="skills@1.5.24"

USAGE="Usage: provision-skills.sh <worktree-path>"
WORKTREE_ARG="${1:?$USAGE}"
[ -d "$WORKTREE_ARG" ] || { echo "Error: '$WORKTREE_ARG' does not exist." >&2; exit 1; }
WORKTREE_PATH="$(cd "$WORKTREE_ARG" && pwd -P)"
COMMON_DIR="$(git -C "$WORKTREE_PATH" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" \
  || { echo "Error: '$WORKTREE_PATH' is not a git worktree." >&2; exit 1; }
PRIMARY_PATH="$(cd "$(dirname "$COMMON_DIR")" && pwd -P)"

say() { echo "  skills: $*" >&2; }
# A path that is there — a dangling link included, which `-e` alone would miss.
present() { [ -e "$1" ] || [ -L "$1" ]; }
has_entries() { [ -d "$1" ] && [ -n "$(ls -A "$1" 2>/dev/null)" ]; }
skill_dirs() {
  (
    cd "$1" && find . -maxdepth 4 \
      \( -path './.claude/worktrees' -o -path './.agents' -o -name node_modules -o -name .venv -o -name .git \) -prune \
      -o -type d -path '*/.claude/skills' -print \
      | sed 's|^\./||' | sort
  )
}

STATUS=0

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
    cp -RP "$src" "$dst"
    COPIED=$((COPIED + 1))
  done
  if [ "$COPIED" -gt 0 ]; then
    say "copied $COPIED entries from $PRIMARY_PATH"
  else
    say "nothing to copy from $PRIMARY_PATH"
  fi
fi

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

LINKS=0
BROKEN=0
while IFS= read -r dir; do
  for link in "$WORKTREE_PATH/$dir"/*; do
    [ -L "$link" ] || continue
    LINKS=$((LINKS + 1))
    name="$dir/$(basename "$link")"
    target="$(readlink "$link")"
    # Resolved from the link's own directory, the way a reader will; the target's parent is
    # entered, so a link to a file resolves too.
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
