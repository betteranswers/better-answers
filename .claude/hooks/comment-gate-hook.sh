#!/usr/bin/env bash
set -uo pipefail



INPUT="$(cat)"
FILE="$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"
[ -n "$FILE" ] || exit 0

if [ "${FILE#/}" = "$FILE" ]; then
  CWD="$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)"
  FILE="${CWD:-$PWD}/$FILE"
fi

DIRECTORY="$(dirname "$FILE")"
[ -d "$DIRECTORY" ] || exit 0
DIRECTORY="$(cd "$DIRECTORY" && pwd -P)"
FILE="$DIRECTORY/$(basename "$FILE")"
[ -f "$FILE" ] || exit 0

ROOT="$(git -C "$DIRECTORY" rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$ROOT" ] || exit 0
ROOT="$(cd "$ROOT" && pwd -P)"

RELATIVE="${FILE#"$ROOT"/}"
[ "$RELATIVE" != "$FILE" ] || exit 0

case "$RELATIVE" in
apps/* | packages/*) ;;
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

if [ "$STATUS" -ne 1 ] || [ -z "$FOUND" ] ||
  { [ -n "$NAMES" ] && [ "${FOUND#*"$NAMES"}" = "$FOUND" ]; }; then
  echo "comment-gate-hook: the comment gate exited $STATUS over $RELATIVE without naming a comment" >&2
  printf '%s\n' "$FOUND" >&2
  exit 0
fi

printf '%s\n' "$FOUND" >&2
echo "comment-gate-hook: $RELATIVE fails the comment gate root \`check\` runs. Fix the comment above, or delete it — absent is the default." >&2
exit 2
