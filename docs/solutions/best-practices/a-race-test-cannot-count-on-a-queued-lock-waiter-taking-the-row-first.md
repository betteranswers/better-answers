---
title: "A race test cannot count on a queued lock waiter taking the row first"
date: 2026-10-21
category: best-practices
module: packages/core
problem_type: best_practice
component: testing-framework
severity: medium
applies_when:
  - "Writing a test where an UPDATE or DELETE queues on a row another transaction holds, and a later read must see the change once that hold is released"
  - "Racing a revocation, a role change or a member's end against a write that reads the member row FOR SHARE (withMember, MEMBER_QUERY_HELD)"
  - "Using until(isBlockedOnALock), until(isBlockedOnTable) or countWaitingOnLocks to decide that a waiter will win the row"
  - "Triaging a race test that fails rarely, under load, with the read seeing the row as it was before the queued change"
symptoms:
  - "concepts.test.ts, \"refuses before committing for a revocation the read cannot see\", failed in 2 of 200 merge-group runs (38686765798, 39491513254) with `expected [ Array(1) ] to deeply equal []`"
  - "erasure-routine.test.ts, \"ends the member after a commit underway, then rewrites it\", failed in build run 39616955529 with `expected { ok: true, … } to deeply equal { ok: false, error: 'not-a-member' }`"
root_cause: concurrency
resolution_type: test_fix
related_components:
  - identity
  - stores
tags:
  - race-test
  - row-lock
  - for-share
  - flaky-test
  - postgres
  - member
---

# A race test cannot count on a queued lock waiter taking the row first

## Context

A write in `packages/core` holds its member row `FOR SHARE` (`withMember`) while git commits, then opens a new transaction for the landing and reads the member row again. Two tests race that write against a statement that changes the member row:

- `concepts.test.ts`, "refuses before committing for a revocation the read cannot see", queues an `UPDATE` (the revocation).
- `erasure-routine.test.ts`, "ends the member after a commit underway, then rewrites it", queues the erasure routine's `DELETE FROM member`.

Each test waits until the statement is blocked on the held row, releases the hold, and expects the write's next read to see the change. Both failed rarely, under load, with that read seeing the old row.

## Why the waiter loses

When the holding transaction commits, Postgres wakes the queued `UPDATE` or `DELETE`, but the row is free until that statement runs again. A new `FOR SHARE` read that arrives in that gap finds no live lock on the row and takes it. The waiter then queues behind the read. Being first in the queue does not reserve the row.

A probe with three connections (hold a row `FOR SHARE`, queue a `DELETE` behind it, commit, read `FOR SHARE` again) saw the old row 1 time in 8,000 on an idle machine. PR #851 measured the concepts test failing 3 times in 1,500 under load. Load widens the gap, so CI hits it more often than a local run does.

The fault is in the tests, not the product (inferred). A read that takes the row first is ordered before the change, like a write that landed a moment earlier. The erasure routine already rewrites such a write ("rewrites a concept the person writes after the git step"). Only the tests claimed the waiter goes first.

## Reproduce it

Pause the woken statement so that the gap is long. Before the test releases the hold, find the waiter's backend pid and stop it. Release the hold, wait 1 s, and continue it:

```ts
const pid = String(
  (
    await db().pool.query(
      "SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE 'DELETE FROM member%'",
    )
  ).rows[0].pid,
);
execFileSync("docker", ["exec", box, "kill", "-STOP", pid]);
await gate.unpark();
await new Promise((resolve) => setTimeout(resolve, 1000));
execFileSync("docker", ["exec", box, "kill", "-CONT", pid]);
```

`box` is the test Postgres container that `deploy/test-postgres.sh up` starts. With the pause, the old erasure test failed 5 of 5 runs with the CI assertion.

## Gate the reader on the state

Do not let the racing read start until the change it must see has settled. `lendingOnceSettled` in `packages/core/test/suite-postgres.ts` wraps a pool so that `connect` first awaits a promise. Give the write the wrapped pool, and point the promise at the state, not at a lock wait:

```ts
let ended: Promise<unknown> = Promise.resolve();
const postgres = { pool: lendingOnceSettled(scenario.postgres.pool, () => ended) };
// ...
await until(async () => (await countWaitingOnLocks(db().pool)) === 1);
ended = until(() => theMemberHasEnded(member));
await gate.unpark();
```

The promise starts resolved, so the write's first connection, the one that holds the row, opens at once. It changes only once the waiter is queued.

Gate on the state you need, not on the statement or routine that produces it. The erasure routine carries on after it ends the member, so awaiting the routine would block the landing for no reason. The member row being gone is the fact the test needs. The concepts test awaits the revocation itself, which ends when its change commits.

The gate does not weaken the test. With `commitAsMember` switched to `withMemberUnheld`, so that the commit no longer holds the member row, the test still fails, at its 60 s timeout. With the gate, the forced pause passed 5 of 5 runs, and the unpaused test passed 100 of 100.

## Related

- [A race test held late, or released in turn, cannot prove a lock order](a-race-test-held-late-or-released-in-turn-cannot-prove-a-lock-order.md): the other way a lock wait misleads a race test. `countWaitingOnLocks` shows that a statement waits, not where. This doc adds that a waiter does not win the row when the hold ends.
- PR #851, which fixed the concepts test and added `lendingOnceSettled`.
- Linear BA-183, with the CI history and the probe.
