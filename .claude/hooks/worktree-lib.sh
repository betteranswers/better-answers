# shellcheck shell=bash # sourced by the worktree hooks, so it carries no shebang of its own
say() {
  echo "$SAY_AS: $*" >&2
}

# $1: a worktree's physical path, the only name jCodeMunch keeps it under.
drop_index() {
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

# Epoch seconds at which a pull request merged with worktree $1's HEAD $2 as its head, or nothing.
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

remove_worktree() {
  local root="$1" worktree="$2" branch="$3" real
  # Before the removal: a path cannot be resolved once its directory has gone.
  real="$(cd "$worktree" && pwd -P)" || return 1
  git -C "$root" worktree remove "$worktree" >&2 2>&1 || return 1
  say "removed $worktree"
  drop_index "$real"
  [ -n "$branch" ] || return 0
  # `-d` weighs a branch against its upstream, else against the main checkout's HEAD, and that
  # HEAD lags the origin/main the worktree was judged by.
  git -C "$root" branch --quiet --set-upstream-to=origin/main "$branch" >/dev/null 2>&1
  if git -C "$root" branch -d "$branch" >/dev/null 2>&1; then
    say "deleted branch $branch"
  else
    say "kept branch $branch — git branch -d finds it unmerged"
  fi
}
