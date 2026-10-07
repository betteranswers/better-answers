---
title: "A ceiling test on the wall clock splits its count across two windows"
date: 2026-10-04
category: best-practices
module: apps/api
problem_type: best_practice
component: testing-framework
severity: medium
applies_when:
  - "Writing or changing a test that sends N+1 requests and expects the last one refused by a rate ceiling"
  - "A ceiling test fails now and then in CI with expected 200 to be 429 on its last request"
  - "Triaging the ceiling tests BA-53 lists (ask-to-join, confirm, members-invitations, oauth-flow, mcp-surface, sign-in-link)"
  - "Changing consumeIngress or the fixed-window flooring in packages/core/src/store/postgres/index.ts"
symptoms:
  - "passkeys.test.ts 'answers 429 at /passkeys/sign-in-options past thirty a minute' failed in a merge-queue run with expected 200 to be 429 on the 31st request"
  - "The failure came and went, was unrelated to the pull request under test, and passed on the pull request's own check"
root_cause: async_timing
resolution_type: test_fix
related_components:
  - api-layer
tags:
  - rate-limit
  - ceiling
  - fixed-window
  - flaky-test
  - clock
  - consume-ingress
  - merge-queue
  - vitest
---

# A ceiling test on the wall clock splits its count across two windows

## Context

An api test that sends one request more than a rate ceiling allows, and expects the last one refused, fails now and then with `expected 200 to be 429`. The ceiling counts in fixed windows that start on the epoch's boundaries. A test that sends its requests on the real clock passes only when every request lands in one window.

It surfaced in the merge queue for #544 (run 37205988406, job `full-api`, 04/10/2026). `apps/api/tests/passkeys.test.ts` › "signing in with a passkey" › "answers 429 at /passkeys/sign-in-options past thirty a minute" failed, though the pull request changed no code. The same test passed on the pull request's own `check`, on every recent `main` merge and on every local run. The CI log puts the failing test at 13:35:00 UTC, on a minute's edge.

What did not explain it:

- **A slow runner.** The 31 requests take about 70 ms locally, and the failure is an answer of 200, not a timeout. A bigger timeout changes nothing.
- **Re-running.** A re-run usually passes, because a run seldom starts within a few milliseconds of an edge. That hides the flaw until the next merge queue it lands in. Earlier sessions handled other timing failures the same way, by re-running until green (session history).
- **`console.log` from a probe.** The api suite shows no `console` output from a test that passes, so a probe that logs timings shows nothing. Write probe output to a file.

## Guidance

**Write a ceiling test against a stopped clock.** Give the suite's api a clock the test can stop, and stop it before the loop that counts. Every request then reads one instant and lands in one window. Every other test in the suite keeps reading real time. This is the fix #547 made in `passkeys.test.ts` (unmerged as of this writing).

**Check an existing ceiling test with the edge probe.** Start the suite's clock a few milliseconds before the rule's window edge (a minute's edge for `windowMs: 60_000`, a ten-minute edge for `10 * 60_000`), then run the test. If it fails with `expected 200 to be 429` at the last request, it has the flaw. For the passkeys test, a lead of 5 to 60 ms failed it with CI's exact assertion; a 50 s lead and a 100 ms lead both passed, because the 31 requests finish inside 100 ms.

**Know what a passing stopped-clock test proves.** It proves the ceiling holds within one window. It does not prove the fix, because a stopped clock passes by construction. The evidence that the edge was the cause is the probe failing the unchanged test.

**Keep every assertion.** The first N answers still contain no 429 and the last is still 429. Confirm the changed test still fails when its ceiling is removed.

## Why This Matters

`windowStart` floors `now` to the rule's window: `new Date(Math.floor(now.getTime() / rule.windowMs) * rule.windowMs)` (`packages/core/src/store/postgres/index.ts:466-467`). `consumeIngress` counts each attempt in the window `now` falls in, and drops the pair's earlier windows (`packages/core/src/store/postgres/index.ts:487-509`). So 30 requests before a minute's edge and 1 after it are counts of 30 and 1, and the 31st answers 200.

The fixed window is right for the product: 30 requests either side of an edge are two windows' worth of traffic. The test was wrong to read the wall clock while it counted.

The flaw is in every test that counts past a ceiling this way, so it recurs: six more were found and not yet checked (BA-53). A longer window fails less often, but each failure costs a merge-queue re-run and invites the re-run habit above.

## When to Apply

- Writing any test that sends requests until a rate ceiling refuses one.
- A ceiling test that fails once in CI and passes on a re-run.
- Working through BA-53's six tests: `ask-to-join`, `confirm` ("the sixth makes the next wait"), `members-invitations` (the per-address ceiling), `oauth-flow` ("the limits"), `mcp-surface` ("answers 429 … past the token's ceiling") and `sign-in-link`.

## Examples

The stopped clock is `aStoppableClock` in `apps/api/tests/suite-app.ts`, which restarts the clock after every test. A suite hands its clock to `appForSuite`:

```ts
const { clock, stopTheClock } = aStoppableClock();

const app = appForSuite({ clock });
```

`appForSuite` passes its options to `startApp`, and `TestAppOptions` takes a `clock` (`apps/api/tests/harness.ts:326`). Each ceiling test calls `stopTheClock()` before its loop (`passkeys.test.ts:211`, `:299`; `confirm.test.ts:587`).

The last answer of a split count is whatever the path answers under its ceiling, not always 200. The confirm and recovery paths are sent `{}`, so a split count answers 400 or 409. BA-68 (merge-queue run 37626160905 for #605, 07/10/2026) failed with `expected 400 to be 429` at `/second-factor/replace/authenticator-finish`, the last of the seven to run, which the log puts at 13:10:00, a ten-minute edge. The edge probe reproduced it with a 5 ms and a 20 ms lead.

The tests it fixed:

| Test | Requests | Rule |
| --- | --- | --- |
| "answers 429 at /passkeys/add-options past ten in ten minutes", and the same at `/passkeys/add` (`passkeys.test.ts:217`) | 11 | `PASSKEY_PERSON_RULE`, 10 in 10 minutes (`apps/api/src/auth/constants.ts:99`) |
| "answers 429 at /passkeys/sign-in-options past thirty a minute", and the same at `/passkeys/sign-in` (`passkeys.test.ts:305`) | 31 | `PASSKEY_SIGN_IN_IP_RULE`, 30 a minute (`apps/api/src/auth/constants.ts:102`) |
| "answers 429 at %s past ten tries", at each of the seven confirm and recovery paths (`confirm.test.ts:583`) | 11 | `CONFIRM_PERSON_RULE` and `AUTHENTICATOR_PERSON_RULE`, 10 in 10 minutes; `SPEND_A_CODE_PERSON_RULE`, 10 an hour (`apps/api/src/auth/constants.ts:55`, `:81`, `:84`) |

## Related

- `docs/solutions/architecture-patterns/adr-0040-clock-is-a-kernel-value.md`: the clock is a value the api hands down. The stopped clock is that value, given to one suite's api; it is not the process-wide clock patched in tests that ADR 0040 rejects.
- `docs/solutions/best-practices/a-ceiling-keyed-on-the-target-does-not-bound-the-actor.md`: what a ceiling counts under, over the same `consumeIngress` and `ingress_counter`.
- #547 (the fix), BA-53 (the six tests still to check).
