#!/usr/bin/env bash
set -euo pipefail

root=${1:?the mirror root, e.g. /data/mirror}
requested=${SSH_ORIGINAL_COMMAND:-}
refuse() { printf 'mirror-shell: refused: %s\n' "$1" >&2; exit 255; }

# A `/`, a `..` or a space is not a workspace id; it is an attempt to leave the root.
is_workspace() { [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$ ]]; }

# Not `git-shell`: it takes git-receive-pack alone, so a workspace's first push would fail.
case "${requested}" in
  "init-repo "*)
    ws=${requested#init-repo }
    is_workspace "${ws}" || refuse "init-repo: not a workspace id"
    target="${root}/${ws}.git"
    [ -d "${target}" ] || git init --quiet --bare "${target}"
    ;;
  "git-receive-pack "*)
    arg=${requested#git-receive-pack }
    arg=${arg#\'}; arg=${arg%\'}   # the client quotes the path
    case "${arg}" in "${root}/"*.git) ;; *) refuse "git-receive-pack: path outside ${root}";; esac
    ws=${arg#"${root}/"}; ws=${ws%.git}
    is_workspace "${ws}" || refuse "git-receive-pack: not a workspace id"
    [ -d "${arg}" ] || refuse "git-receive-pack: no such mirror (init-repo first)"
    exec git-receive-pack "${arg}"
    ;;
  # Without this the mirror keeps the objects an erasure replaced on VPC 1.
  "prune-repo "*)
    ws=${requested#prune-repo }
    is_workspace "${ws}" || refuse "prune-repo: not a workspace id"
    target="${root}/${ws}.git"
    [ -d "${target}" ] || refuse "prune-repo: no such mirror"
    git -C "${target}" reflog expire --expire=now --all
    git -C "${target}" gc --prune=now --quiet
    ;;
  *) refuse "not a mirror command" ;;
esac
