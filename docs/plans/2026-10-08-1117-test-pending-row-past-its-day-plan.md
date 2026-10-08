---
title: A Pending Words Row Past Its Day - Plan
type: test
date: 2026-10-08
topic: pending-row-past-its-day
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# A Pending Words Row Past Its Day - Plan

## Goal Capsule

- **Objective:** A rename sweep cannot merge and leave its words row `pending` without the words test saying so. The next sweep (BA-59's U2, or any later rename) does not repeat what #616 had to clean up by hand.
- **Means:** A pending row names the day its sweep is due to merge. The words test refuses a pending row that names no such day, or whose day has passed, and names the row and its sweep (KTD1, KTD2).
- **Authority:** BA-71's acceptance criteria, then the Key Technical Decisions, then the units.
- **Stop conditions:** a change here would need `CONCEPTS.md` restructured, or a landed row edited. BA-59's U2 owns both.
- **Execution profile:** one pull request, `Fixes BA-71`. It adds no pending row, so `check` stays green on the day it merges.
- **Who finishes:** `ce-work` builds it, `ce-code-review` reviews it, and `ce-commit-push-pr` opens the pull request.

---

## Product Contract

### Summary

A `pending` row in `apps/api/tests/old-words.ts` carries `landsBy`, the day its sweep is due to merge. The words test fails on a pending row with no `landsBy`, and on one whose `landsBy` is before today. The failure names the row's word and its sweep.

### Problem Frame

A row stays `pending` until its sweep flips it to `landed`. While it is pending no scan reads it, so the old word is never refused. Nothing ties the row to its sweep's merge. On 08/10/2026 BA-29's Definition-of-Done audit found *actor id* and *person id* (U8, #550) and the Models group's old name (U9, #552) still pending five days after their sweeps merged. The old name was still written in `packages/design-system/readme.md`, ADR 0017 and ADR 0047. #616's commit `bdc7f732` landed all three by hand.

The two cases differ. U9 landed its other two rows and forgot one. U8 changed nothing in `old-words.ts`: it landed no row and declared no landing date. So no check that waits for a sweep to leave a mark in the list can catch the U8 case.

### Requirements

- R1. A row whose sweep has merged cannot stay `pending` without the words test failing.
- R2. The failure names the row and its sweep.
- R3. A test plants a stale `pending` row and sees it refused.
- R4. The learning that tells a sweep how to land a word says what a pending row now carries.

### Scope Boundaries

- `CONCEPTS.md` is not edited. BA-59's U2 reshapes it next and touches the same test files, so this change stays inside what BA-71 needs.
- No landed row changes. Every row in the list is landed today.
- The `_Code rename pending._` mark and `unlisted` stay as they are.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **A pending row names the day its sweep is due, and the test refuses it once that day has passed** (the implementer's choice, following the option BA-71 suggested; chosen over a check that a sibling row of the same sweep has landed and over a check that the pending word is no longer written: the U8 case left no mark in the list, and the Models group's old name was still written when its sweep merged). The field is an optional `landsBy` on `Renamed`, so the fixtures that spread a landed row into a pending copy (`pendingNow` and the planted `{ ...row, state: "pending" }` cases) still type-check. The test's own scan refuses a pending row without it. The comparison is strict, as in `writtenBefore`: the due day itself passes. The test cannot see a merge, so it meets R1 from the named day on: a sweep that merges early and forgets its row stays green until that day. The day is therefore the sweep's expected merge day, with no margin added. Governs R1, R2.
- KTD2. **The check takes today's date from its caller.** ADR 0040 says no parameter defaults to `new Date()`. The new exported function in `words-scan.ts` takes `rows` and `today` (`YYYY-MM-DD`). The live test passes today's UTC date, and the planted tests pass a fixed one. Governs R1, R3.
- KTD3. **Its own function and its own live test, beside `listFaults`.** `listFaults` reports where the list and the glossary disagree, and its message says so. An overdue row is a different fault with a different remedy: land the row, or move `landsBy` if the sweep has not merged. A separate `it` in "the list of old words" gives it its own message, and `listFaults`' signature stays as BA-59's U2 finds it. Governs R2.
- KTD4. **A `landsBy` that is not a `YYYY-MM-DD` day counts as no day.** The check compares strings. A day written `2026-10-4` sorts after `2026-10-08` and would keep passing for weeks. Governs R1.

### Risks

| Risk | Mitigation |
|---|---|
| The check reads the wall clock. Once a pending row's day passes, the merge queue refuses every group, and a local `check` fails, with no commit, until someone lands or re-dates the row. A pull request runs no suite, so it stays green | This is the alarm BA-71 asks for. The failure message names the remedy. The pull request body says so. This pull request adds no pending row, so nothing turns red when it merges |
| A sweep that slips moves `landsBy` forward and the row stays pending | Moving the day is an edit a reviewer sees in the diff, which is the point. The learning says to move it only when the sweep has not merged |

### Assumptions

- The words test runs in CI on UTC. Taking the UTC date means a row due on its last day goes red at midnight UTC, which is 01:00 in the UK in summer. That hour does not matter.

---

## Implementation Units

### U1. Refuse a pending row past its day

- **Goal:** the words test fails on a pending row with no `landsBy`, or one whose `landsBy` has passed, naming the row and its sweep.
- **Requirements:** R1, R2, R3; KTD1 to KTD4.
- **Dependencies:** none.
- **Files:**
  - `apps/api/tests/old-words.ts`: `landsBy` on `Renamed`, with a one-line comment.
  - `apps/api/tests/words-scan.ts`: the exported check.
  - `apps/api/tests/avoid-words.test.ts`: the live test and the planted cases.
- **Approach:**
  1. Add `readonly landsBy?: string` to `Renamed`, said in its comment to be the day its sweep is due to merge, required while the row is pending.
  2. In `words-scan.ts`, export a function over `rows` and `today` that returns one fault per pending row: one with no `landsBy` in day form, and one whose `landsBy` is before `today`. Each names the word and the sweep. Landed and avoided rows yield nothing.
  3. In "the list of old words", add a test that runs it over `OLD_WORDS` with today's UTC date and expects no fault. Its message says to land the row once the sweep has merged, or to move `landsBy` if the sweep has not.
  4. In "faults in a planted list", plant pending rows against a fixed `today`.
- **Patterns to follow:** `unlisted` and its planted cases (`words-scan.ts`, `avoid-words.test.ts` "faults in a planted list"); `writtenBefore`'s strict date comparison in `old-words.ts`.
- **Execution note:** write the planted cases first and watch them fail before the function exists.
- **Test scenarios:**
  - A pending row whose `landsBy` is the day before `today` is refused, and the fault names its word and its sweep. This is R3's stale row.
  - A pending row due on `today` passes.
  - A pending row due after `today` passes.
  - A pending row with no `landsBy` is refused, naming its word and its sweep.
  - A pending row whose `landsBy` is `2026-10-4` is refused as naming no day.
  - A landed row whose `landsBy` has passed yields nothing, and so does an avoided row.
  - On the real list, the check finds nothing, because every row is landed.
- **Verification:** `pnpm --filter @better-answers/api run test tests/avoid-words.test.ts` passes, and the api's `check` passes.

### U2. Say in the learning what a pending row carries

- **Goal:** a sweep, or whoever adds a pending row, knows to give it `landsBy` and to land the row in the sweep's own pull request.
- **Requirements:** R4.
- **Dependencies:** U1.
- **Files:** `docs/solutions/best-practices/how-a-rename-sweep-lands-a-word-in-the-words-test.md`.
- **Approach:**
  1. Fix the two passages that still describe the `pending(...)` helper, which `bdc7f732` removed: the row-shapes list in Context and the pending-row example under Examples. The example's pending row is written in full with `landsBy`.
  2. Trap 2 says nothing refuses a pending row. Add that a pending row now needs a `landsBy` and is refused once the day passes, so flipping a landed row back to pending fails unless it names a day.
  3. In procedure step 2, remove "`pending(...)` cannot express a landed row", and say that the flip removes `landsBy` and that every row of the sweep lands in the sweep's pull request.
  4. Say how to choose the day: the day the sweep is expected to merge, from its plan or its issue, with no margin. A later day only delays the alarm. If the sweep slips, move the day in a commit a reviewer sees.
  5. Bump `last_updated`, add one `applies_when` line for adding a pending row, and change the `symptoms` line's "a row flipped back to pending" to "a row flipped back to pending with a later `landsBy`".
- **Test expectation:** none — prose. The docs lane's formatting and the words test read it.
- **Verification:** `pnpm check:docs` passes.

---

## Verification Contract

| Check | Proves | Applies to |
|---|---|---|
| The planted cases fail before the function exists and pass after | R3, and that the check bites | U1 |
| `pnpm --filter @better-answers/api run check` | R1, R2: the live test, types and the rest of the api's suites | U1 |
| `pnpm check:gates` | The `.ts` edits pass lint and the comment gates | U1 |
| `pnpm check:docs` | The learning's formatting, and the words test over it | U2 |

---

## Definition of Done

- A pending row with no `landsBy`, or with a `landsBy` before today, fails the words test with a message naming its word and its sweep.
- The planted stale row is refused, and the row due today passes.
- The learning describes the pending row as it is now written.
- No abandoned wording or experimental edits are left in the diff.

---

## Appendix

### Sources

- Linear BA-71, and BA-29's Definition-of-Done comment of 08/10/2026.
- `bdc7f732` (#616's second commit), which landed the three rows.
- `docs/solutions/architecture-patterns/adr-0040-clock-is-a-kernel-value.md`.
- `docs/solutions/best-practices/how-a-rename-sweep-lands-a-word-in-the-words-test.md`.
