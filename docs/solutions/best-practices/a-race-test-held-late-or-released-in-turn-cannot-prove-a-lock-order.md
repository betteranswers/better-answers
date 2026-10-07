---
title: "A race test held late, or released in turn, cannot prove a lock order"
date: 2026-10-02
category: best-practices
module: packages/core
problem_type: best_practice
component: testing-framework
severity: medium
applies_when:
  - "Writing a test that proves concurrent actions take shared locks or rows in one order (sorted counter keys, rows locked in key order), so crossing actions cannot deadlock"
  - "Using whileActionsWaitAt or racedAt from packages/core/test/suite-postgres.ts to hold racing actions at a BEFORE INSERT or BEFORE UPDATE trigger"
  - "Choosing which table's insert or update a race holds its actions at"
  - "Adding a lock, counter or row write ahead of the statement an existing race test holds at"
  - "Triaging a surviving mutant on a sort, comparator or key order in code that takes locks"
symptoms:
  - "A Stryker run on 2026-10-02 left the ArrowFunction mutant on the counter-key sort comparator in emailsCounted (packages/core/src/members/invitation-ceilings.ts) surviving"
  - "The crossing-sends race test in invitation-sets.test.ts passed with the counter keys taken in any order, because it held its actions at the invitation insert, after the counters, and its trigger let them through one at a time"
root_cause: concurrency
resolution_type: test_fix
related_components:
  - identity
  - stores
tags:
  - race-test
  - lock-order
  - deadlock
  - advisory-lock
  - postgres
  - mutation-testing
  - surviving-mutant
  - invitations
---

# A race test held late, or released in turn, cannot prove a lock order

## Context

A race test proves that two actions take their locks in one order only when the actions are held at the first statement where they contend and released together, so that their statements interleave from that point. Held at a later statement, or released one action at a time, the first action through takes every lock it needs before the second takes any. The test then passes with the order and without it, and still reads like a race test.

This came up on the invitation send. `emailsCounted` takes one `invitation_email_counter` row per address and one for the workspace, sorted by key so that two sends sharing a counter queue rather than deadlock. The test written to guard that, "lands both of two crossing sends whole", passed with the sort removed. A Stryker run on 2026-10-02 found it: the ArrowFunction mutant on the sort's comparator survived. The fix is on PR #511, unmerged as of this writing (2026-10-02).

### The helpers

`whileActionsWaitAt` (`packages/core/test/suite-postgres.ts:172-204`) holds actions at a table. A holder connection takes a session-level `pg_advisory_lock` on a fixed key (line 187). A `BEFORE INSERT` or `BEFORE UPDATE` row trigger on the table then takes the same key again (189-195). Every action that writes the table blocks inside the trigger until the test calls `release`, which runs `pg_advisory_unlock` (182-186). `racedAt` (217-234) starts every action, waits with `until` until `countWaitingOnLocks` (213-214) counts one waiter per action, releases, and answers each action.

Before PR #511 the trigger always took `pg_advisory_xact_lock`, which is exclusive and held until the transaction ends:

```ts
     BEGIN PERFORM pg_advisory_xact_lock(${key}, ${key}); RETURN NEW; END $$`,
```

So after `release` one action won the lock and kept it until its commit, and the others passed the trigger one at a time behind it.

### The send and its counters

`sentUnderLocks` (in `packages/core/src/members/invitations.ts`) counts first, through `emailsCounted`, then reads the members among the addresses, then mints through `mintedEach`, which writes the `invitation` rows. In `packages/core/src/members/invitation-ceilings.ts`, `countersOf` lists one counter per address in the order sent, then the workspace's counter with `amount: addresses.length`, and `emailsCounted` sorts them by key before taking any:

```ts
  const counters = countersOf(admin, addresses).toSorted((one, other) =>
    byCodeUnit(one.key, other.key),
  );
```

Each counter is taken by `consumeInvitationEmails` (`packages/core/src/store/postgres/index.ts:521-546`), an `INSERT ... ON CONFLICT (workspace_id, key, window_start) DO UPDATE SET count = invitation_email_counter.count + EXCLUDED.count`, run inside the action's transaction. Its comment says the counter row "stays held until it commits". So the first counter statement is where two sends contend. Without the sort, a send of `[ana, ben]` takes ana's row and then wants ben's, while a send of `[ben, ana]` holds ben's and wants ana's.

Stryker's ArrowFunction mutator replaces the comparator with `() => undefined`. A comparator that answers `undefined` treats every pair as equal, and `toSorted` is stable, so the order falls back to `countersOf`'s: the addresses as sent, then the workspace. That is exactly the crossing the test arranges.

The old test (`packages/core/test/invitation-sets.test.ts:308-334`) raced those two sends at the `invitation` table's `INSERT`, released in turn (the default):

```ts
    const answers = await racedAt(db().pool, "invitation", [
      () => sending(workspace, [ana, ben], "Viewer"),
      () => sending(workspace, [ben, ana], "Editor"),
    ]);
```

The `invitation` insert comes after every counter, so nothing held the actions at their counters. Whether their counter statements interleaved was left to timing, and the surviving mutant says that in the session's run they did not.

## Guidance

To prove a lock order, hold the actions at the first statement that contends, and release them together.

A race test can fail to prove the order in two independent ways:

1. **Held later than the first contended statement.** The actions run unheld up to the hold point, so their contended statements happen before it, in whatever order timing gives. Typically one action takes its contended locks before the other takes any, and the other queues behind it. The race at the hold point is then between an action that has its locks and one waiting on them. This is the old test: the hold at `invitation` sits after `emailsCounted`.
2. **Released in turn.** Even held at the right statement, an exclusive transaction-level lock at the hold point serialises the actions there. The first action through holds the others at the trigger until it commits, so the second takes its first contended row only after the first has committed all of its rows.

PR #511 gives `whileActionsWaitAt` and `racedAt` a `released` argument, `"in turn"` by default so every existing test behaves as before (`suite-postgres.ts:164-169`, 177, 221):

```ts
type Released = "in turn" | "together";

const HOLD_OF: Readonly<Record<Released, string>> = {
  "in turn": "pg_advisory_xact_lock",
  together: "pg_advisory_xact_lock_shared",
};
```

The trigger body now takes whichever lock `released` names (line 190):

```ts
     BEGIN PERFORM ${HOLD_OF[released]}(${key}, ${key}); RETURN NEW; END $$`,
```

Releasing together needs the shared lock. The holder's session-level `pg_advisory_lock` conflicts with both the exclusive and the shared transaction-level lock, so either form blocks every action in the trigger until `release`. They differ after that. The exclusive lock is granted to one waiter, which keeps it to its commit. Shared requests are compatible with one another, so on unlock every waiter is granted at once. Each action's later writes to the table fire the trigger again and take the shared lock again without waiting, since nothing now holds the key exclusively. From the release on, the actions' statements interleave as two unsynchronised actions' would.

A `BEFORE INSERT` row trigger fires before Postgres checks for a conflict, so a hold on `invitation_email_counter` catches every counter statement, including one that ends on the `ON CONFLICT ... DO UPDATE` path. Held there, neither action holds any counter row at the release.

One more trap: `countWaitingOnLocks` counts every statement in the database waiting on any lock (`statementsWaitingOnALock`, 206-211, reads `pg_stat_activity` for `wait_event_type = 'Lock'`). `racedAt`'s wait is satisfied as readily by an action queued on another action's row as by one held at the trigger. A count of waiters does not show where they wait.

### Reading the failure

When the order is missing, Postgres finds the cycle after `deadlock_timeout` (1 s by default) and aborts one action with SQLSTATE `40P01`, "deadlock detected". In this send that error does not come back as a throw. `inviteMembers`, in `packages/core/src/members/invitations.ts`, runs `sentUnderLocks` under `attempt` and maps the error through `refusalOfDeadlock` (`packages/core/src/store/postgres/index.ts:137`, 139-144), so the aborted send answers the refusal `changed-meanwhile` rather than throwing. The test then fails at `expect(answers.map((answer) => answer.ok)).toEqual([true, true])` (`invitation-sets.test.ts:351`). In this session's run, with the sort removed, the test failed at about 1,050 ms. A race test that fails a little over a second in, with a `40P01` or the refusal it maps to, is reporting a missing lock order.

To confirm the test now constrains the code, use the controls in `docs/agents/mutation-triage.md`. It holds that "A harness that answers only one way says nothing", and that "The same line's opposite is the best pair: One expression, two verdicts, is a harness that discriminates." Here the pair was one probe on the comparator, run before and after the new test: per this session's runs, `pnpm mutant-probe` answered `survived` before and `killed` after.

## Why This Matters

A race test is what a reviewer trusts for lock order, and lock order is hard to check by reading. A race test that cannot fail gives that trust for nothing. The sort could be dropped, or a new counter added out of order, and `check` would stay green until two real sends crossed and one answered `changed-meanwhile`. Here only a surviving mutant showed the gap, and only because the mutation run reached that comparator.

The tree after PR #511 carries what `"together"` does (the comment on `Released`), but not where to hold. A future test can still call `racedAt` at a later table with the default and pass whatever the order.

## When to Apply

- A test whose claim is that concurrent actions take shared locks in one order, or do not deadlock: hold at the first statement that contends and pass `"together"`.
- A sort, an ordering or a lock acquisition that a mutation run reports as surviving a race test: check where the race holds and how it releases before calling the mutant equivalent.
- A new lock or counter added ahead of an existing hold point: the hold may no longer be at the first contended statement.

`"in turn"` remains right for a different claim: that a later action sees, and respects, the rows an earlier action committed. "leaves one waiting of two concurrent invitations to one address" (`packages/core/test/invitations.test.ts:209-229`) and "adds one of two concurrent adds of one address" (`packages/core/test/workspaces.test.ts:1378-1395`) race that way, and are correct as written: the second action must commit after the first and find its row. The old crossing test proves the same kind of thing, that the second send replaces the first's waiting invitations (`invitation-sets.test.ts:319-325`), and it stays. In `packages/core/test` the two helpers have ten call sites, eight of `whileActionsWaitAt` and two of `racedAt`, and only the new test passes `"together"`. That is no reason to switch the others.

## Examples

Before: the only crossing race held at `invitation`, after every counter, released in turn. It passed with and without the sort (`invitation-sets.test.ts:313-316`, shown above).

After: a second test, "takes two crossing sends' counters in one order", holds the same two sends at their first `invitation_email_counter` insert and releases them together (`invitation-sets.test.ts:336-353`):

```ts
    const answers = await racedAt(
      db().pool,
      "invitation_email_counter",
      [
        () => sending(workspace, [ana, ben], "Viewer"),
        () => sending(workspace, [ben, ana], "Editor"),
      ],
      "together",
    );

    expect(answers.map((answer) => answer.ok)).toEqual([true, true]);
    expect(await emailsCountedFrom(workspace)).toBe(4);
```

With the sort, both actions want the same first key. One inserts it, and the other's `INSERT ... ON CONFLICT` waits on that uncommitted row until the first commits, then counts on top. Both land, and the workspace counter reads 4: two sends of two addresses (the workspace's counter in `countersOf` counts `addresses.length`; `emailsCountedFrom` reads the workspace's counter, `packages/core/test/invitations-suite.ts:180-182`). Without the sort, each action inserts a different first row and then wants the other's, and one is aborted as a deadlock.

## Related

- [Mutation triage](../../agents/mutation-triage.md): the probe and the controls both ways that turned the survivor into a verified kill. This learning is a second survivor shape beside the one its closing paragraph names: a race that cannot interleave.
- [ADR 0043, what an action is](../architecture-patterns/adr-0043-what-an-act-is.md): an action counts a ceiling inside its own transaction, which is why two crossing sends contend on the counter rows at all.
- [The People layout rework plan](../../plans/2026-10-01-1807-feat-people-layout-rework-plan.md), KTD2: a bulk action runs in one transaction, every deadlock maps to `changed-meanwhile`, and a per-action lock order avoids the further deadlocks a mixed order would add.
- `CODING_STANDARDS.md`: *Triage the nightly mutation summary, never the score* (a survivor the nightly summary newly names is a task) and *Assert a provoked transaction's outcome before any value* (the new test asserts each answer's `ok` before the counter).
- PR #511, which adds `released` and the new test.
