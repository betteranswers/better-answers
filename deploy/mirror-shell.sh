#!/usr/bin/env bash
# Better Answers — the forced command behind the git-mirror deploy key on VPC 2 (ADR 0024).
#
# `backup.sh nightly` on VPC 1 does three things over that key: `ssh mirror@vpc2 init-repo <ws>`
# to create the bare target if it is absent, then `git push --mirror` to it, which the git
# client sends as `git-receive-pack '/data/mirror/<ws>.git'`, and then — only when that push
# replaced refs, which is what an erasure's history rewrite does — `prune-repo <ws>`. Those three
# commands are the whole grammar this shell accepts; anything else is refused and logged. Installed by
# `deploy/host-setup.sh vpc2` as `/usr/local/bin/mirror-shell`, and named in the mirror user's
# `authorized_keys` as
#   command="/usr/local/bin/mirror-shell /data/mirror",restrict ssh-ed25519 AAAA…
# so the key can neither open a shell nor forward a port. `restrict` (OpenSSH ≥ 7.2) is the
# one word that turns every forwarding and pty option off at once.
#
# Why not `git-shell`: it accepts `git-receive-pack` alone, so the first push to a workspace
# that has no mirror yet fails — which is exactly the case a new workspace creates the night
# after its first commit. The wizard's earlier "restricted to git-receive-pack" line was the
# rule that would have broken the mirror (ticket 79 op F9); this file is the correction.
set -euo pipefail

root=${1:?the mirror root, e.g. /data/mirror}
requested=${SSH_ORIGINAL_COMMAND:-}
refuse() { printf 'mirror-shell: refused: %s\n' "$1" >&2; exit 255; }

# A workspace id is one path segment of DNS-safe characters; a `/`, a `..` or a space is not
# a workspace, it is an attempt to leave the root.
is_workspace() { [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$ ]]; }

case "${requested}" in
  "init-repo "*)
    ws=${requested#init-repo }
    is_workspace "${ws}" || refuse "init-repo: not a workspace id"
    target="${root}/${ws}.git"
    [ -d "${target}" ] || git init --quiet --bare "${target}"
    ;;
  "git-receive-pack "*)
    arg=${requested#git-receive-pack }
    arg=${arg#\'}; arg=${arg%\'}                       # the client quotes the path
    case "${arg}" in "${root}/"*.git) ;; *) refuse "git-receive-pack: path outside ${root}";; esac
    ws=${arg#"${root}/"}; ws=${ws%.git}
    is_workspace "${ws}" || refuse "git-receive-pack: not a workspace id"
    [ -d "${arg}" ] || refuse "git-receive-pack: no such mirror (init-repo first)"
    exec git-receive-pack "${arg}"
    ;;
  "prune-repo "*)
    # The third verb, and the last (the ADR 0024 amendment of 11/09/2026). A `git push --mirror`
    # that replaced refs leaves the objects it replaced on this box, reachable through the reflog
    # git-receive-pack wrote, so without this the mirror keeps what the erasure routine erased on
    # VPC 1 and the two copies disagree about what a subject was told is gone. The routine prunes
    # the first copy; the backup service calls this for the second, because the push is the only
    # thing that knows a rewrite happened. Argument-checked exactly as init-repo is, and it takes
    # a workspace id and no options — nothing here is reachable by choosing a clever path.
    ws=${requested#prune-repo }
    is_workspace "${ws}" || refuse "prune-repo: not a workspace id"
    target="${root}/${ws}.git"
    [ -d "${target}" ] || refuse "prune-repo: no such mirror"
    git -C "${target}" reflog expire --expire=now --all
    git -C "${target}" gc --prune=now --quiet
    ;;
  *) refuse "not a mirror command" ;;
esac
