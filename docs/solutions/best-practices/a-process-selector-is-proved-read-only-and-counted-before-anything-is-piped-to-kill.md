---
title: "A process selector is proved read-only, and its hits counted, before anything is piped to kill"
date: 2026-10-15
category: best-practices
module: .claude/hooks
problem_type: best_practice
component: development-workflow
severity: high
applies_when:
  - "Writing a shell helper that finds processes by command line (ps, pgrep, pkill) and ends them"
  - "Adding a kill step to a hook or sweep that runs unattended, such as the worktree hooks under .claude/hooks"
  - "Smoke-testing any new selector-then-destroy pipeline by hand, on the developer's own machine"
  - "Passing a pattern into awk, grep or sed through environment variables rather than arguments"
  - "Reviewing a change that pipes a process list into kill, docker rm, rm -rf or git worktree remove"
symptoms:
  - "A first smoke test of a new worker-killing helper sent TERM then KILL to every process on the machine, and the Mac restarted"
  - "An awk selector that was meant to match a worktree path and a worker marker printed every pid ps listed"
tags:
  - worktree-hooks
  - sweep-worktrees
  - process-selector
  - kill
  - awk
  - bash-pipeline
  - environment-prefix
  - smoke-test
  - destructive-guard
---

# A process selector is proved read-only, and its hits counted, before anything is piped to kill

## Context

The change this doc rode in with gives the worktree sweep a step that finds vitest fork workers
orphaned by a killed run and ends them, because three such workers had each burned a core for hours. The helper lists processes with
`ps`, selects those whose arguments name a worktree path and the marker `vitest/dist/workers/`,
and pipes the pids into a killer that sends TERM, waits, then KILL. Its first smoke test ran the
whole pipeline at once. The selector printed every pid on the machine, the killer took them all,
and the Mac restarted.

Two shell traps combined to make the selector match everything:

- An environment assignment written as a prefix on a pipeline, `A=x B=y ps ... | awk '...'`, binds
  to the first command only. awk saw empty strings in `ENVIRON`.
- BSD awk, which macOS ships, answers `index(s, "")` with 1, so an empty needle is found in every
  line. Both conditions in the selector were therefore true for every process.

Neither trap is visible in the pipeline's text, and both were only found by running the selector
on its own and reading what it printed.

## Guidance

Treat a selector that feeds a destructive command as two deliverables, proved in order.

1. **Run the selector alone and read its hits.** Print each matched line with its command line, not
   the pid alone. Against a known arrangement (two decoys, one of which should match) the output is
   checked by eye before any destructive stage exists.
2. **Count before destroying.** A smoke script that chains selector and destroyer compares the hit
   count to the expected number and refuses to go on when they differ:

   ```bash
   N="$(test_workers_under "$D/" orphaned | wc -l | tr -d ' ')"
   [ "$N" = 1 ] || { echo "REFUSING: orphaned count is $N, not 1"; exit 1; }
   test_workers_under "$D/" orphaned | kill_test_workers
   ```

3. **Give the destroyer its own refusals.** It takes only what a selector can legitimately produce:
   plain numbers above 1 that are not the shell running it.
4. **Give the selector a refusal for an empty pattern**, since an empty pattern is the shape of
   every match-all failure. The snippet below refuses one, in the shell and again in awk.
5. **Pass patterns to awk through an exported subshell environment**, never as a prefix assignment
   on the pipeline, so every pipeline process sees them and no process's own arguments carry the
   pattern that would make it match itself. The snippet below is the form.
6. **Prefer `ps -axwwo`** when the selector reads command lines. A vitest worker's arguments run
   long, with the marker at the end, and a width-limited `ps` would cut it off silently.

A decoy that mirrors the real target's shape is part of the proof, not an afterthought. A short
decoy proved the pattern but not the width; a decoy built with the real path shape proved both.

## Why This Matters

A selector bug in a read-only command costs a re-run. The same bug behind `kill`, `docker rm`,
`rm -rf` or `git worktree remove` costs whatever was running: here, every Claude session, the
live test run and the machine itself. The repo's hooks run these steps unattended on every worktree
creation, so the selector is exercised far more often than it is read. The cost of proving it
first is one extra command.

## When to Apply

- Any new or changed selector in the worktree hooks, the sweep or a `scripts/` reaper that feeds
  a destructive command.
- Any smoke test of such a change run on the developer's own machine, where the blast radius is
  the whole session.
- Any awk, grep or sed invocation in a hook that takes its pattern from the environment, because
  the prefix-assignment trap and the empty-needle trap recur there.

## Examples

Before, the selector that matched everything:

```bash
WORKERS_UNDER="$1" WORKERS_MARK="vitest/dist/workers/" \
  ps -axo pid=,ppid=,args= | awk '
    index($0, ENVIRON["WORKERS_UNDER"]) && index($0, ENVIRON["WORKERS_MARK"]) { print $1 }'
```

After, the selector that is exported to the whole pipeline and refuses an empty pattern:

```bash
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
```

The repository's tests once proved the same thing with a decoy: an idle node process whose arguments
mirror a worker's, orphaned or attached. The orphan had to die and the attached one had to survive.
The worktree sweep that ran this selector, and those tests, have since been deleted.

## Related

- `docs/solutions/integration-issues/munch-indexes-stale-across-worktrees.md`: the worktree hooks
  and how they are tested with stubbed tools on PATH.
