---
title: "A test that one transaction never makes another wait parks the reader on a table neither side touches"
date: 2026-10-04
category: best-practices
module: packages/core
problem_type: best_practice
component: testing-framework
severity: medium
applies_when:
  - "Proving that a long read or export holds no row another act needs, so that act never waits on it"
  - "Testing that a read moved off a held door (withMember, FOR SHARE) onto an unheld one (withMemberUnheld) stops blocking role changes or removals"
  - "Needing to pause a transaction partway when the statement to pause at is a SELECT, where the BEFORE INSERT/UPDATE triggers of whileActsWaitAt cannot hold it"
  - "Choosing the lock or table a concurrency test parks one side on"
symptoms:
  - "A no-wait claim tested by running the two acts one after the other passes whether or not the first holds the row, because its transaction has already committed"
  - "A no-wait test that parks the reader too early, before its member read, passes with the held door too, so it proves nothing"
root_cause: concurrency
resolution_type: test_fix
related_components:
  - stores
  - members
tags:
  - race-test
  - lock-timeout
  - pg-locks
  - access-exclusive
  - for-share
  - unheld-read
  - postgres
  - concurrency
---

# A test that one transaction never makes another wait parks the reader on a table neither side touches

## Context

People U14 (BA-49) added an audit-log export that reads up to 10,000 events. A mutation reads its caller's member `FOR SHARE` (ADR 0043, `docs/solutions/architecture-patterns/adr-0043-what-an-act-is.md`), and a role change takes every Admin's member row `FOR UPDATE` (`packages/core/src/members/last-admin.ts:36-37`). An export on that road would stall every other Admin's role change for as long as it read. So the export reads through `withMemberUnheld` (`packages/core/src/store/postgres/index.ts:367`), which runs `MEMBER_QUERY` (line 255) without the `FOR SHARE OF m, u` that `MEMBER_QUERY_HELD` (line 269) adds.

The plan's test scenario was "while an export runs, another Admin's role change does not wait on it". Running the two one after the other proves nothing, because the export's transaction has ended before the role change starts. The repository's race helpers, `whileActsWaitAt` and `racedAt` (`packages/core/test/suite-postgres.ts:172`, `:217`), hold acts at a `BEFORE INSERT` or `BEFORE UPDATE` trigger. The export's read writes nothing, so a trigger has nothing to hold.

## Guidance

Park the reader on a table lock that only a **later** statement of the reader touches, then run the contender with a lock timeout while the reader is parked:

1. **Hold a table the reader reaches after the row it is accused of holding, and that the contender never touches.** `groupTableHeld` (`packages/core/test/audit-export.test.ts:322`) opens a transaction and takes `LOCK TABLE "group" IN ACCESS EXCLUSIVE MODE` (line 325). The export's search reads `"group"` in `groupsNamed` (`packages/core/src/members/audit-log.ts:175`, the `SELECT` at `:181`), after the member query has run. That query reads `member`, `"user"` and `group_member`, never `"group"`. A role change never reads `"group"` either.
2. **Know the reader is parked before starting the contender.** `waitingOnTheGroupTable` (line 334) polls `pg_locks` joined to `pg_class` for a lock on `group` that is `NOT l.granted` (line 338). A fixed sleep would race.
3. **Bound the contender instead of letting it hang.** The role change runs on another connection after `SET LOCAL lock_timeout = '2s'` (line 406). If the reader held the Admin's member row, the change fails with a lock timeout rather than hanging the suite.
4. **Release the table, then await the reader.** The export finishes once the lock is gone.
5. **Prove the test discriminates.** Swap the reader onto the held door (`withMemberUnheld(admitted.value` to `withMember(admitted.value` in `packages/core/src/members/audit-export.ts`): the test must fail on the timeout. In this session it did, after 2s with `{ ok: false }`, and it passed again on the unheld door.

The test is "lets another Admin change a role meanwhile" (line 394). Its export searches for `"Cal"` (line 400), so `groupsNamed` runs and the park lands where it should.

## Why This Matters

A no-wait claim fails silently. Put the export back on the held door and nothing errors: every other Admin's role change and removal simply queues for the length of an export. A test that cannot catch that is worse than none, because it reads as proof. The two traps both produce a test that passes either way:

- **Parking too early.** If the held table is one the reader touches before the row it is accused of holding, the reader stops before taking that row. The contender then passes on the held door too. Here, the member query must not touch the parked table.
- **Parking on a table the contender needs.** The contender then waits on the test's own lock, and the test fails on both doors. `ACCESS EXCLUSIVE` blocks even a plain `SELECT`, so check every statement of the contender, not just its writes. A table the contender only reads is no better.

## When to Apply

- Any "does X wait on Y" test where X is a read, or where the moment to pause at is a read.
- Moving an act from a held door to an unheld one, or narrowing which rows an act holds.
- Not for proving a lock order between two writers. Hold those at the first contended write with `whileActsWaitAt`, as `docs/solutions/best-practices/a-race-test-held-late-or-released-in-turn-cannot-prove-a-lock-order.md` explains.

## Examples

The shape, from `packages/core/test/audit-export.test.ts`:

```ts
const held = await groupTableHeld(); // LOCK TABLE "group" IN ACCESS EXCLUSIVE MODE

const exporting = exportAs(workspace, workspace.adminUserId, { search: "Cal" });
await waitingOnTheGroupTable(); // pg_locks: a lock on "group", NOT granted
const changed = await readingAs(db().runtimePool, beasMember, async (principal, tx) => {
  await tx.query("SET LOCAL lock_timeout = '2s'");
  return changeRole(principal, tx, inputOf(changeRoleInput, { personId: cal, role: "Editor" }));
});
await held.released();

expect(changed).toMatchObject({ ok: true, value: { personId: cal, role: "Editor" } });
expect((await exporting).ok).toBe(true);
```

A related trap from the same session's mutation probes. A probe that rewrites a SQL arm so that it no longer references its bound parameter (for example the former-member arm `e.actor = $3 || u.id` in `packages/core/src/members/audit-log.ts:165`, rewritten to `false`) breaks the whole statement, because Postgres cannot type an unreferenced parameter. That kills every test reaching the query and says nothing about the arm. Probe with a mutation that keeps the parameter in use (`e.actor = $3 || 'none'`). Then only the test written for that arm fails.
