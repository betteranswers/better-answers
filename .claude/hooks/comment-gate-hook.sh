#!/usr/bin/env bash
set -uo pipefail

# Only exit 2's stderr reaches the model; all else exits 0, so a tree with no gate refuses no edit.
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
# Physically: git answers resolved paths, so a `/tmp` that is `/private/tmp` would match no root.
DIRECTORY="$(cd "$DIRECTORY" && pwd -P)"
FILE="$DIRECTORY/$(basename "$FILE")"
[ -f "$FILE" ] || exit 0

ROOT="$(git -C "$DIRECTORY" rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$ROOT" ] || exit 0
ROOT="$(cd "$ROOT" && pwd -P)"

RELATIVE="${FILE#"$ROOT"/}"
[ "$RELATIVE" != "$FILE" ] || exit 0

# Root `lint` reads every TypeScript file. The Python gate reads only these roots, so the hook
# reads the same ones.
case "$FILE" in
*.ts | *.tsx | *.mts | *.cts | *.js | *.jsx | *.mjs | *.cjs) ;;
*)
  case "$RELATIVE" in
  apps/* | packages/* | scripts/* | .claude/hooks/* | .github/* | deploy/*) ;;
  cubic.yaml | lefthook.yml | pnpm-workspace.yaml) ;;
  *) exit 0 ;;
  esac
  ;;
esac

# The root config's ignore patterns: oxlint skips them on a walk and lints a file named to it.
case "/$RELATIVE" in
*/node_modules/* | */dist/* | */coverage/* | */reports/* | */.venv/* | */stryker-setup-*.js) exit 0 ;;
/packages/devtools/lifts/anti-slop/* | /.claude/worktrees/* | /.claude/skills/* | /apps/api/.claude/skills/*) exit 0 ;;
esac

COMMENT_RULES='better-answers\((comment-only-the-why|declaration-doc-block|string-cites-nothing)\)|typescript\((ban-ts-comment|prefer-ts-expect-error)\)|eslint\(no-warning-comments\)|unicorn\(no-abusive-eslint-disable\)|Unused (eslint|oxlint)-disable directive'

case "$FILE" in
*.ts | *.tsx | *.mts | *.cts | *.js | *.jsx | *.mjs | *.cjs)
  TOOL="$ROOT/node_modules/.bin/oxlint"
  if [ ! -x "$TOOL" ]; then
    echo "comment-gate-hook: $TOOL is not installed, so nothing read $RELATIVE" >&2
    exit 0
  fi
  OUTPUT="$(cd "$ROOT" && "$TOOL" --report-unused-disable-directives-severity=error --format=unix "$RELATIVE" 2>&1)"
  STATUS=$?
  # The root config holds every rule and a parse error answers 1 too; only a comment rule refuses.
  FOUND="$(printf '%s\n' "$OUTPUT" | grep -E "$COMMENT_RULES" || true)"
  ;;
*.py)
  if ! command -v python3 >/dev/null 2>&1; then
    echo "comment-gate-hook: python3 is absent, so nothing read $RELATIVE" >&2
    exit 0
  fi
  FOUND="$(cd "$ROOT" && python3 packages/devtools/python/comment_gate.py "$RELATIVE" 2>&1)"
  STATUS=$?
  ;;
*) exit 0 ;;
esac

[ "$STATUS" -eq 0 ] && exit 0

# A 1 naming no comment is the gate failing; refusing that edit leaves the agent no rule to read.
if [ "$STATUS" -ne 1 ] || [ -z "$FOUND" ]; then
  echo "comment-gate-hook: the comment gate exited $STATUS over $RELATIVE without naming a comment" >&2
  printf '%s\n' "${OUTPUT:-$FOUND}" >&2
  exit 0
fi

printf '%s\n' "$FOUND" >&2
echo "comment-gate-hook: $RELATIVE fails the comment gate root \`check\` runs. Fix the comment above, or delete it — absent is the default." >&2
exit 2
