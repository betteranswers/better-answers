# shellcheck shell=bash # sourced by the worktree hooks, so it carries no shebang of its own
# Appended, so a tool already on PATH wins. A hook the desktop client starts has launchd's bare PATH.
PATH="$PATH:$HOME/Library/pnpm:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin"

say() {
  echo "$SAY_AS: $*" >&2
}

drop_index() {
  drop_code_index "$1"
  drop_doc_index "$1"
}

# $1: a worktree's physical path, the only name jCodeMunch keeps it under.
drop_code_index() {
  command -v jcodemunch-mcp >/dev/null 2>&1 || return 0
  local repo
  repo="$(jcodemunch-mcp list-repos --json 2>/dev/null \
    | jq -r --arg root "$1" 'map(select(.source_root == $root)) | first | .repo_id // empty' \
      2>/dev/null || true)"
  if [ -z "$repo" ] || [ "$repo" = "null" ]; then
    say "jcodemunch: no index named $1"
  elif jcodemunch-mcp delete-index "$repo" >/dev/null 2>&1; then
    say "jcodemunch: dropped the index $repo"
  else
    say "jcodemunch: could not drop the index $repo — run jcodemunch-mcp delete-index $repo by hand"
  fi
}

# $1: a worktree's physical path. provision-worktree.sh names its doc index after the folder.
drop_doc_index() {
  command -v jdocmunch-mcp >/dev/null 2>&1 || return 0
  drop_doc_repo "local/$(basename "$1")"
}

drop_doc_repo() {
  if jdocmunch-mcp delete-index --repo "$1" >/dev/null 2>&1; then
    say "jdocmunch: dropped the index $1"
  else
    say "jdocmunch: no index $1 to drop"
  fi
}

doc_indexes() {
  jdocmunch-mcp watch-status 2>/dev/null \
    | jq -r '.repos[]? | select(.repo and .source_root) | [.repo, .source_root] | @tsv' \
      2>/dev/null || true
}

# $1: a folder path ending in `/`. A worktree removed without the remove hook leaves its doc index.
drop_orphan_doc_indexes() {
  command -v jdocmunch-mcp >/dev/null 2>&1 || return 0
  local repo root
  while IFS=$'\t' read -r repo root; do
    case "$root" in
      "$1"?*) [ -d "$root" ] || drop_doc_repo "$repo" ;;
    esac
  done < <(doc_indexes)
}

is_clean() {
  local status
  status="$(git -C "$1" status --porcelain 2>/dev/null)" || return 1
  [ -z "$status" ]
}

head_names() {
  local branch
  branch="$(git -C "$1" branch --show-current 2>/dev/null)"
  [ -n "$branch" ] || return 0
  {
    echo "$branch"
    git -C "$1" config --get "branch.$branch.merge" 2>/dev/null | sed 's#^refs/heads/##'
  } | sort -u
}

# A branch that moved on after its merge holds work the merge never saw, so the head must match.
pr_merged_at() {
  command -v gh >/dev/null 2>&1 || return 0
  local name at
  for name in $(head_names "$1"); do
    at="$( (cd "$1" && gh pr list --state merged --head "$name" --json headRefOid,mergedAt) \
      2>/dev/null | jq -r --arg head "$2" \
      'map(select(.headRefOid == $head)) | first | .mergedAt // empty | fromdateiso8601' \
      2>/dev/null)"
    [ -n "$at" ] && { echo "$at"; return 0; }
  done
  return 0
}

# A vitest fork worker names its tree in its arguments. The patterns reach awk through the
# environment, exported in a subshell so the whole pipeline sees them: a prefix assignment binds to
# ps alone, and BSD awk finds an empty string in every line. Neither pipeline process names the
# folder, so neither matches itself.
# $1: a folder path ending in `/`; $2, when given: list only workers whose parent has gone.
test_workers_under() {
  [ -n "$1" ] || return 0
  (
    export WORKERS_UNDER="$1" WORKERS_ORPHANED="${2:-}" WORKERS_MARK="vitest/dist/workers/"
    ps -axwwo pid=,ppid=,args= 2>/dev/null | awk '
      length(ENVIRON["WORKERS_UNDER"]) > 0 \
        && index($0, ENVIRON["WORKERS_UNDER"]) && index($0, ENVIRON["WORKERS_MARK"]) \
        && (ENVIRON["WORKERS_ORPHANED"] == "" || $2 == 1) { print $1 }'
  )
}

# Reads pids, one per line, and takes only a plain number above 1 that is not this shell. A worker
# that outlived its run has been seen to ignore TERM, so KILL follows for any still there. Bash
# 3.2, which a desktop-started hook runs under, has no arrays here.
kill_test_workers() {
  local line pids="" pid
  while IFS= read -r line; do
    case "$line" in '' | *[!0-9]*) continue ;; esac
    [ "$line" -gt 1 ] && [ "$line" != "$$" ] && pids="$pids$line
"
  done
  [ -n "$pids" ] || return 0
  while IFS= read -r pid; do [ -z "$pid" ] || kill "$pid" 2>/dev/null; done <<<"$pids"
  sleep 2
  while IFS= read -r pid; do
    [ -z "$pid" ] || { kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null; }
  done <<<"$pids"
  say "killed the vitest workers $(printf '%s' "$pids" | tr '\n' ' ')"
}

remove_worktree() {
  local root="$1" worktree="$2" branch="$3" real
  # Before the removal: a path cannot be resolved once its directory has gone.
  real="$(cd "$worktree" && pwd -P)" || return 1
  git -C "$root" worktree remove "$worktree" >&2 2>&1 || return 1
  say "removed $worktree"
  # After the removal, so a refused one leaves a live run alone; the slash keeps siblings apart.
  test_workers_under "$real/" | kill_test_workers
  drop_index "$real"
  [ -n "$branch" ] || return 0
  # `-d` weighs a branch by its upstream, else by the main checkout's HEAD, which lags origin/main.
  git -C "$root" branch --quiet --set-upstream-to=origin/main "$branch" >/dev/null 2>&1
  if git -C "$root" branch -d "$branch" >/dev/null 2>&1; then
    say "deleted branch $branch"
  else
    say "kept branch $branch — git branch -d finds it unmerged"
  fi
}
