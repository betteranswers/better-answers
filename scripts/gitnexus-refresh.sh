#!/bin/sh
# Rebuilds the GitNexus graph after a merge or pull, so impact answers describe the checked-out tree.
# `.gitnexus/` is untracked and lives only in the main checkout, so a worktree has no runner and skips.
# An analyze takes about 80 seconds, so it runs detached and the merge returns at once.
[ -f .gitnexus/run.cjs ] || exit 0

# One rebuild at a time. mkdir is atomic, so a second merge during a rebuild skips.
lock=.gitnexus/refresh.lock
mkdir "$lock" 2>/dev/null || { echo "gitnexus: a rebuild is already running"; exit 0; }

# A hook inherits GIT_DIR and the other local git variables. Clear them so the analyzer reads this checkout.
for variable in $(git rev-parse --local-env-vars); do unset "$variable"; done
(node .gitnexus/run.cjs analyze > .gitnexus/refresh.log 2>&1; rmdir "$lock") > /dev/null 2>&1 &
echo "gitnexus: rebuilding the graph in the background (log: .gitnexus/refresh.log)"
