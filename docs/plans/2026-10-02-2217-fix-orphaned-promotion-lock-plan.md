---
title: Orphaned Promotion Lock - Plan
type: fix
date: 2026-10-02
topic: orphaned-promotion-lock
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Orphaned Promotion Lock - Plan

## Goal Capsule

- **Objective:** a person added before their first sign-in always ends their first completed email-code sign-in verified, with every session and linked account they held before it gone, even when an earlier sign-in died part-way through.
- **Means:** a before-hook on the email-code sign-in deletes that person's expired promotion lock, so the library's own promotion runs in full (KTD1, KTD2).
- **Product authority:** the owner, through Linear BA-39. BA-28's plan (`docs/plans/2026-10-01-2241-feat-people-sign-in-and-security-plan.md`) belongs to the owner's BA-28 work and is not edited here.
- **Open blockers:** none.
- **Stop conditions:** stop and report if the U1 integration test passes with the hook disabled, because then it does not reproduce the orphan; or if the delete is refused under the identity principal, because the fix would then need a principal change that ADR 0009 governs.
- **Execution profile:** Lightweight. Two units in one pull request, `Fixes BA-39`. No migration and no `contracts/` edit, so it need not run alone.
- **Finishes and ships:** `/ce-work`, then `/ce-code-review`, `ce-commit-push-pr` and `ce-babysit-pr`.

## Product Contract

### Summary

Before `/sign-in/email-otp` runs, the api deletes the signing-in person's promotion lock when the person is unverified and the lock has expired. A live lock still makes a concurrent sign-in wait, as it does today. The learning doc that records #514 gains the fix, a corrected account of the old window, and the lock's name in its upgrade check.

### Problem Frame

Better Auth 1.7.5 promotes a person whose `emailVerified` is false at their email-code sign-in. It revokes their sessions and linked accounts, then sets `emailVerified`. A five-second lock row, `revoke-unproven-account-access:<userId>`, guards the promotion. If the process dies, or the lock's delete fails (the library swallows it), the row is left behind. The person's next sign-in then finds the lock taken, waits, sees it expired, deletes it and returns the person unchanged. That sign-in mints a session, skips the revocation and leaves the address unverified.

Before #514, any lookup of the table deleted expired rows, and the person's own retry ran that delete before reserving, so an orphan lived about five seconds. #514 turned that deletion off (`verification.disableCleanup: true`), so an orphan now lasts until that person's next sign-in uses it up or the daily sweep removes it, 24 to 48 hours later.

Today only `ops add-person` people start unverified, and they hold no session or linked account, so nothing leaks. Such a person does stay unverified, though, so accepting an invitation is refused (`packages/core/src/members/accepting.ts:126`) until their next email-code sign-in. Once BA-28's U6 ships passkeys, a person who signs in only by passkey would stay unverified for good. Once U13 ships Microsoft sign-in, the delayed revocation would delete a Microsoft account the person linked themselves.

### Requirements

**The sign-in**

- R1. An unverified person's completed email-code sign-in revokes the sessions and linked accounts they held before it and marks their address verified, whether or not an expired promotion lock of theirs is left in the table.
- R2. A live promotion lock is never deleted ahead of the library, so a second sign-in during a promotion still waits for it.
- R3. Clearing the lock never refuses a sign-in. When the delete fails, the sign-in goes on as it does today and the api writes a warning log line.
- R4. The sign-in by link gets the same clearing, because it reaches the library through the same path.

**The record**

- R5. The learning doc says the orphan is now cleared, gives the old window's true account, and its upgrade check names the lock's identifier.

### Scope Boundaries

- No local patch to Better Auth. A patch that retries the reserve after clearing an expired lock would be about ten lines, but it needs re-applying on every bump.
- No more frequent sweep of lock rows. It would shrink the window but not close it.
- No better-auth bump. Renovate's 1.7.7 changes how a session-create hook sets the active workspace (#11375), and the api relies on that; it is flagged to the owner, not taken here.
- No upstream Better Auth issue. Filing one is outward-facing and the owner's call.
- `apps/api/src/smtp.ts` is not touched.

#### Deferred to Follow-Up Work

- BA-28's U10 now extends this `hooks.before` rather than adding the first one. Its plan says "the before-hook over remaining endpoints"; the owner's next BA-28 session amends U10, and this pull request's body says so.
- BA-28's U16 deletes expired identity-set rows. It must keep #514's one-day grace, as the learning doc's Prevention section already says.

### Sources / Research

- The library, at `apps/api/node_modules/better-auth/dist/`, version 1.7.5: `db/revoke-unproven-account-access.mjs` (lock at `:3,6`, reserve at `:35-39`, the early return at `:42-45`, the revocation at `:49-52`, the swallowed delete at `:54`); `db/internal-adapter.mjs` (`findUserByEmail` lowercases and matches exactly at `:568-576`; the reservation id is `SHA-256("reserve:" + identifier)`, base64url with no padding, at `:885`); `plugins/email-otp/routes.mjs:407-441` (the sign-in and its promotion); `api/dispatch.mjs:64-110` (a before-hook runs on HTTP and `auth.api.*` dispatch and sees the raw body before validation). Unchanged through 1.7.7.
- `docs/solutions/logic-errors/better-auth-lookup-deleted-another-persons-expired-sign-in-code.md`: #514's learning, whose "Residual" section first named this gap.
- `docs/solutions/best-practices/better-auth-closed-endpoints-run-as-server-functions-without-router-guards.md`: why a server-function call is not an HTTP call; it does not apply here, since the link reaches the library over `auth.handler`.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Clear the lock in the api, before the library runs.** A `hooks.before` on `/sign-in/email-otp` deletes the expired lock, so the library's reserve succeeds and its promotion runs whole. Chosen over a local patch to the library and over a frequent sweep (Scope Boundaries): it closes the gap with no patch to re-apply on each bump. A library rename of the lock makes the hook delete nothing, which restores today's behaviour rather than breaking sign-in. The integration test cannot see that, because a renamed library ignores the row it seeds, so a test pins the library's lock name and reservation id against the installed source (U1), and the learning doc's upgrade check points to it (U2).
- KTD2. **One statement, matched the way the library matches.** `apps/api/src/auth/promotion-lock.ts` runs one `DELETE … USING "user"` through `withIdentityWrite(IDENTITY_PRINCIPAL, …)`. It matches the person by `email` equal to the body's address lowercased in the api, which is how `findUserByEmail` finds the person the library will promote. It uses the unique index on `user.email`, where `lower(u.email)` would not. It requires `NOT email_verified`, the lock identifier `revoke-unproven-account-access:` followed by the person's id (`verification_identifier_idx`), and `expires_at <= now`, the library's own expiry test. It answers the count deleted, in the shape of `apps/api/src/auth/expired-verifications.ts`.
- KTD3. **The api's clock, threaded into `createAuth`.** `apps/api/src` reads no ambient clock (`apps/api/tests/no-ambient-clock.test.ts`), so `AuthDependencies` gains `clock: Clock`. `apps/api/src/server.ts` passes `doors.clock`; `apps/api/tests/auth-instance.ts` passes `systemClock()`. The library writes the lock's expiry from the process clock, which `systemClock` is in production.
- KTD4. **A failed delete is a log line.** The hook runs the delete inside `attempt()` and, on failure, writes `audit.warn` with event `auth.promotion_lock_not_cleared` and the reason, then returns. This follows `keepALink`'s handling in `sendVerificationOTP` (`apps/api/src/auth/auth.ts`). A failed clear leaves the sign-in exactly where it is today, so refusing it would make the fix worse than the defect (R3).
- KTD5. **The body is parsed defensively.** The hook sees the request body before the endpoint validates it, so it reads `email` through a zod schema that answers `undefined` on any other shape, as `bodyFields` does, and returns at once when there is none.
- KTD6. **ADR 0009 stands unamended.** The hook moves none of its decisions: Better Auth stays the in-process identity provider, `disabledPaths` is unchanged, and the api's routes still call closed endpoints as server functions.

### Assumptions

- The delete runs before the library checks the code, so a wrong code also clears an expired lock. That is harmless: only an expired lock of an unverified person goes, and the endpoint's rate limit (10 per 10 minutes per address) bounds the extra statement.
- The identity principal may read `user` in a `DELETE … USING` join, since `workspacesHeldBy` already reads it under that principal. The Goal Capsule's stop condition covers the case where it may not.
- A second promotion of the same person running more than five seconds alongside the first would now revoke too, where today it skips. Both revocations are idempotent, and two live sign-ins need two valid codes for one address, which the library's single code per address prevents.

---

## Implementation Units

### U1. Clear an expired promotion lock before the email-code sign-in

**Goal:** the library's promotion always runs in full for an unverified person, whatever lock an earlier sign-in left.

**Requirements:** R1, R2, R3, R4. KTD1 to KTD5.

**Dependencies:** none.

**Files:**
- new `apps/api/src/auth/promotion-lock.ts`
- `apps/api/src/auth/auth.ts` (the `clock` dependency and the `hooks.before`)
- `apps/api/src/server.ts` (passes `doors.clock`)
- `apps/api/tests/auth-instance.ts` (passes `systemClock()`)
- new `apps/api/tests/promotion-lock.test.ts`

**Approach:**
1. Write the delete (KTD2) and the identifier prefix it uses, with a comment naming the library file that owns the name.
2. Add `clock` to `AuthDependencies` and to its two callers (KTD3).
3. Add `hooks.before` beside the existing `hooks.after`: return unless the path is `/sign-in/email-otp`; read the email (KTD5); run the delete inside `attempt()` (KTD4).

**Execution note:** write the integration test first and run it with the hook absent. It must fail on `email_verified` still false and on the earlier session and account still present. Only then wire the hook.

**Patterns to follow:** `apps/api/src/auth/expired-verifications.ts` for the delete's shape; `sendVerificationOTP`'s `attempt` and `audit.warn` in `apps/api/src/auth/auth.ts` for the failure path; `apps/api/tests/provoke.ts` (`codeSentPastItsExpiry`) for ageing a row on the process clock; `testData(client).account` in `packages/schema/test/factory.ts` for the account.

**Test scenarios:**
- Integration, the defect. A person seeded by `app().person()` (unverified by default) signs in once from a first client, so they hold a real session; their address is set unverified again; an account row is added for them; an expired lock is seeded with the library's reservation id (`SHA-256` of `reserve:` plus the identifier, base64url, unpadded) and identifier. A second client then signs in with a fresh code: the first client's session is gone, the account is gone, and `email_verified` is true.
- Integration, the link. The same seeding, then a sign-in through the link (`apps/api/tests/sign-in-link.test.ts`'s flow): the account is gone and `email_verified` is true.
- Direct, the boundary. With `now` fixed, a lock expiring exactly at `now` is deleted and the function answers 1; a lock expiring 1 ms after `now` stays and it answers 0.
- Direct, the person. A verified person's expired lock stays. Another person's expired lock stays when this person signs in. An address given in mixed case still finds the lower-case person.
- Direct, other rows. An expired sign-in code for the same person stays; only the lock's identifier is touched.
- The library pin. Read the installed `better-auth` dist, resolved through the package rather than a hard-coded path: it still builds the promotion lock as the prefix `promotion-lock.ts` exports followed by the user id, and still derives the reservation id from `reserve:` plus the identifier. A bump that changes either fails here instead of turning the hook into a silent no-op, as `apps/api/tests/better-auth-endpoints.test.ts` does for the endpoint list.
- Failure path. When the delete is refused, the sign-in still answers 200 and the log carries one `auth.promotion_lock_not_cleared` warning. If no seam refuses this delete alone without refusing the library's own writes, cover the branch with a direct test of the hook's handling and say so in the pull request.

**Verification:** the integration test fails with the hook removed and passes with it; `no-ambient-clock.test.ts` still passes; scoped mutation testing on `promotion-lock.ts` and the hook leaves no surviving mutant on the `<=`, the `NOT email_verified` or the path check.

### U2. Record the fix in the learning doc

**Goal:** the next person to upgrade Better Auth knows the hook exists, why, and how to tell if a release made it a no-op.

**Requirements:** R5. KTD1.

**Dependencies:** U1.

**Files:** `docs/solutions/logic-errors/better-auth-lookup-deleted-another-persons-expired-sign-in-code.md`

**Approach:**
1. Rewrite "Residual: an orphaned lock skips one revocation" as fixed: the hook, its file, and the test that holds it.
2. Correct the old window: it was about five seconds because the person's own retry ran the table-wide delete (`plugins/email-otp/routes.mjs:763`) before reserving. Add that after a skip the person stays unverified, so accepting an invitation is refused.
3. Name U1's library-pin test in the upgrade check as the guard against a renamed lock, which would make the hook delete nothing. Add a grep for `revoke-unproven-account-access` under `node_modules/better-auth/dist` as the way to find the new name when that test fails.
4. Replace "unmerged" in the Solution and Related Issues sections with "merged as #514", and add the new test to "Tests that hold it".

**Test expectation:** none -- documentation; the root `check:docs` gate covers it.

**Verification:** the doc no longer calls the gap residual or #514 unmerged, states the old window as about five seconds and why, and its upgrade check names the library-pin test and the lock.

---

## Verification Contract

| Proves | Command | Unit |
| --- | --- | --- |
| The hook and the delete | `pnpm --filter @better-answers/api run test tests/promotion-lock.test.ts` | U1 |
| Nothing else in sign-in moved | `pnpm --filter @better-answers/api run test tests/sign-in-and-consent.test.ts tests/sign-in-link.test.ts tests/no-ambient-clock.test.ts tests/better-auth-endpoints.test.ts` | U1 |
| Types and lint | `pnpm --filter @better-answers/api run typecheck` and `pnpm --filter @better-answers/api run lint` | U1 |
| The tests constrain the delete | `/mutation-testing` scoped to `apps/api/src/auth/promotion-lock.ts` and the hook, triaged per `docs/agents/mutation-triage.md` | U1 |
| The docs gates | `pnpm run check:docs` | U2 |

Run the api suites with `IMAGE_PROBE_DEFERRED=true`. CI's merge group is the arbiter (`docs/agents/workflow.md`).

## Definition of Done

- The U1 integration test was seen failing without the hook and passes with it.
- Every Verification Contract row passes locally.
- The learning doc carries the four changes in U2.
- The pull request says `Fixes BA-39`, the commit footer says `Refs: BA-39`, and the pull request names BA-28's U10 as the next extender of the hook.
- No experimental code from abandoned attempts is left in the diff.
