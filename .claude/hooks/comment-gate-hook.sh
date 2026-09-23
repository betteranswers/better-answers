#!/usr/bin/env bash
set -uo pipefail

# Exit 2 is the only code whose stderr reaches the model; every other outcome exits 0, so
# a tree without the gate refuses no edit.
INPUT="$(cat)"
FILE="$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"
[ -n "$FILE" ] || exit 0

# The docs' own example is a relative path, so resolve one against the session's directory.
if [ "${FILE#/}" = "$FILE" ]; then
  CWD="$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)"
  FILE="${CWD:-$PWD}/$FILE"
fi

DIRECTORY="$(dirname "$FILE")"
[ -d "$DIRECTORY" ] || exit 0
# Physically: git answers with a resolved path, and a `/tmp` that is really `/private/tmp`
# would read as outside every root.
DIRECTORY="$(cd "$DIRECTORY" && pwd -P)"
FILE="$DIRECTORY/$(basename "$FILE")"
[ -f "$FILE" ] || exit 0

ROOT="$(git -C "$DIRECTORY" rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$ROOT" ] || exit 0
ROOT="$(cd "$ROOT" && pwd -P)"

RELATIVE="${FILE#"$ROOT"/}"
[ "$RELATIVE" != "$FILE" ] || exit 0

# Every root root `check` gates and no other: one short is a rule learnt a pull request late,
# one over refuses an edit CI accepts.
case "$RELATIVE" in
apps/* | packages/* | scripts/* | .claude/hooks/* | .github/* | deploy/*) ;;
cubic.yaml | jscpd.config.mjs | knip.config.ts | lefthook.yml | pnpm-workspace.yaml) ;;
*) exit 0 ;;
esac

case "/$RELATIVE" in
*/node_modules/* | */dist/* | */coverage/* | */reports/* | */.venv/*) exit 0 ;;
/packages/devtools/lifts/anti-slop/*) exit 0 ;;
esac

case "$FILE" in
*.ts | *.tsx | *.mts | *.cts | *.js | *.jsx | *.mjs | *.cjs)
  TOOL="$ROOT/node_modules/.bin/oxlint"
  if [ ! -x "$TOOL" ]; then
    echo "comment-gate-hook: $TOOL is not installed, so $RELATIVE went unchecked" >&2
    exit 0
  fi
  FOUND="$(cd "$ROOT" && "$TOOL" --config packages/devtools/lint-rules/comment-gate.oxlintrc.json "$RELATIVE" 2>&1)"
  STATUS=$?
  # oxlint answers 1 for a parse error and an unloadable config too, so only the rule's own
  # name means a comment.
  NAMES="better-answers(comment-only-the-why)"
  ;;
*.py | *.yml | *.yaml | *.sh | *.bash | *.toml | *.sql)
  if ! command -v python3 >/dev/null 2>&1; then
    echo "comment-gate-hook: python3 is absent, so $RELATIVE went unchecked" >&2
    exit 0
  fi
  FOUND="$(cd "$ROOT" && python3 packages/devtools/python/comment_gate.py "$RELATIVE" 2>&1)"
  STATUS=$?
  NAMES=""
  ;;
*) exit 0 ;;
esac

[ "$STATUS" -eq 0 ] && exit 0

# A 1 naming no rule is the gate failing, not the comment, and refusing that edit leaves the
# agent no rule to read.
if [ "$STATUS" -ne 1 ] || [ -z "$FOUND" ] ||
  { [ -n "$NAMES" ] && [ "${FOUND#*"$NAMES"}" = "$FOUND" ]; }; then
  echo "comment-gate-hook: the comment gate exited $STATUS over $RELATIVE without naming a comment" >&2
  printf '%s\n' "$FOUND" >&2
  exit 0
fi

printf '%s\n' "$FOUND" >&2
echo "comment-gate-hook: $RELATIVE fails the comment gate root \`check\` runs. Fix the comment above, or delete it — absent is the default." >&2
exit 2
