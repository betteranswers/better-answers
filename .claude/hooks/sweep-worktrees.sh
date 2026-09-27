#!/usr/bin/env bash
set -uo pipefail

# Claude Code fires the remove hook only for a worktree whose agent changed nothing, so one that
# committed outlives its merge. Other agents are at work in the worktrees beside those it removes.
SAY_AS=sweep-worktrees
. "$(dirname "${BASH_SOURCE[0]}")/worktree-lib.sh"

USAGE="Usage: sweep-worktrees.sh [<main-checkout>]"
COMMON="$(git -C "${1:-.}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" \
  || { echo "$USAGE" >&2; exit 1; }
ROOT="$(cd "$(dirname "$COMMON")" && pwd -P)"
UNDER="$ROOT/.claude/worktrees/"

# An agent may still be reporting, or be resumed, in a worktree whose pull request just merged.
GRACE_SECONDS=3600

git -C "$ROOT" fetch --quiet origin main >/dev/null 2>&1 \
  || say "fetch failed — judging by the origin/main last fetched"
NOW="$(date +%s)"

# Epoch seconds of the merge that brought commit $2 into origin/main, or nothing. A fresh worktree's
# HEAD sits on origin/main's own line, holding no commit of its own, so that never counts.
landed_at() {
  git -C "$1" merge-base --is-ancestor "$2" origin/main 2>/dev/null || return 0
  case "$(git -C "$1" rev-list --first-parent origin/main)" in
    *"$2"*) return 0 ;;
  esac
  git -C "$1" log --first-parent --ancestry-path --format=%ct "$2..origin/main" | tail -1
}

sweep_one() {
  local head at
  is_clean "$1" || { say "keeping $1 — it has changed or untracked files"; return 0; }
  head="$(git -C "$1" rev-parse HEAD 2>/dev/null)" || return 0
  at="$(landed_at "$1" "$head")"
  [ -n "$at" ] || at="$(pr_merged_at "$1" "$head")"
  [ -n "$at" ] || { say "keeping $1 — no merge holds its commits"; return 0; }
  [ $((NOW - at)) -ge "$GRACE_SECONDS" ] || { say "keeping $1 — merged under an hour ago"; return 0; }
  remove_worktree "$ROOT" "$1" "$(git -C "$1" branch --show-current 2>/dev/null)" \
    || say "keeping $1 — git worktree remove refused it"
}

is_under() {
  case "$(cd "$1" 2>/dev/null && pwd -P)/" in
    "$UNDER"?*) return 0 ;;
  esac
  return 1
}

unlocked_worktrees() {
  local line path="" held=0
  while IFS= read -r line; do
    case "$line" in
      "worktree "*) path="${line#worktree }"; held=0 ;;
      locked* | prunable*) held=1 ;;
      "") [ "$held" = 0 ] && [ -n "$path" ] && is_under "$path" && echo "$path"; path="" ;;
    esac
  done < <(git -C "$ROOT" worktree list --porcelain; echo)
}

WORKTREES="$(unlocked_worktrees)"
while IFS= read -r wt; do
  [ -z "$wt" ] || sweep_one "$wt" </dev/null
done <<<"$WORKTREES"
