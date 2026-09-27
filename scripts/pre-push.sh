#!/bin/sh
# git names each ref being pushed on stdin: <local ref> <local sha> <remote ref> <remote sha>.
# A deletion's local sha is all zeros.
while read -r _ local_sha remote_ref _; do
  case "$remote_ref" in refs/heads/*) ;; *) continue ;; esac
  case "$local_sha" in *[!0]*) exec pnpm exec lefthook run pre-push-gates ;; esac
done
echo "gates skipped: every ref pushed is a deletion or outside refs/heads/, so none carries commits"
