---
title: "Better Auth's lookup deleted every expired code, so a person's just-expired sign-in code read as wrong rather than spent"
date: 2026-10-02
category: logic-errors
module: apps/api
problem_type: logic_error
component: identity
applies_when:
  - "Changing the email-code sign-in, Better Auth's `verification` options, or the sweep pass that expires codes"
  - "Seeing `INVALID_OTP` where `OTP_EXPIRED` was expected, or a flaky expired-code spec in `sign-in.spec.ts`"
  - "Upgrading `better-auth`"
symptoms:
  - "A person typing a just-expired email code got INVALID_OTP, which the sign-in page reads as 'That code is wrong.' with tries left, instead of OTP_EXPIRED, which it reads as spent"
  - "It happened only when another request looked up a verification row between the code's expiry and its holder's try; the holder's own lookup alone answered OTP_EXPIRED"
  - "The expired-code spec in apps/web/e2e/auth/sign-in.spec.ts was flaky under parallel Playwright workers, because other workers' sign-ins deleted the aged code"
root_cause: wrong_api
resolution_type: config_change
severity: medium
framework_version: "better-auth 1.7.5"
retire_when: "a better-auth release past 1.7.5 stops deleting expired verification rows inside internalAdapter.findVerificationValue (the deleteManyWithHooks call guarded by options.verification.disableCleanup in dist/db/internal-adapter.mjs); check the better-auth release notes and that dist file in the installed version"
tags:
  - better-auth
  - verification
  - email-otp
  - disable-cleanup
  - expired-code
  - sweep-pass
  - cross-request
  - flaky-test
  - promotion-lock
---

# Better Auth's lookup deleted every expired code, so a person's just-expired sign-in code read as wrong rather than spent

## Problem

Better Auth 1.7.5 deletes every expired row in its `verification` table each time `findVerificationValue` runs, unless `verification.disableCleanup` is set (`apps/api/node_modules/better-auth/dist/db/internal-adapter.mjs`). So any person's sign-in deleted every other person's sign-in code once it had expired. A person who then typed their own just-expired code was told it was wrong, with tries left, instead of that it was spent.

That table is the library's store of short-lived tokens: sign-in codes and links, OAuth state, trusted devices and locks. It is not the glossary's _verification_, which is the platform's check of a concept or a write-up.

## Symptoms

- After someone else had tried a code, a person typing a code just past its expiry got `400 INVALID_OTP` rather than `400 OTP_EXPIRED`. The sign-in page showed "That code is wrong. Check it and try again. 2 tries left." instead of "That code can't be used any more." (the wording of the time; `apps/web/src/features/auth/refusal-words.ts` has since reworded both). The page reads a code as spent only on a 403 or `OTP_EXPIRED` (`codeSpent` in `apps/web/src/features/auth/code-entry.ts`).
- Every later try was refused as wrong as well, so the page counted tries down for a code the database no longer held.
- On its own, the same code read correctly as expired. The fault needed another request's lookup between the expiry and the holder's try.
- The browser spec "an expired code reads as spent, handing focus to another" (`apps/web/e2e/auth/sign-in.spec.ts`) was flaky under parallel Playwright workers: another worker's sign-in deleted the aged code before the spec typed it.

## What Didn't Work

No fix attempt failed. The defect surfaced while the expired-code browser spec was being built, and reading `findVerificationValue` in the installed library settled the cause (session history). Two approaches look sufficient and are not:

- **Reading the answer differently in the browser.** The web layer already reads `OTP_EXPIRED` as spent, because the library deletes a code as it reports it expired (`EXPIRED` in `apps/web/src/features/auth/code-entry.ts`). That cannot help here. The row was gone before the holder's first try, so the server's first answer was already `INVALID_OTP`, and no mapping in the web app can tell that from a wrong code.
- **Testing the expired code alone.** A test that ages one person's code and types it passes with or without the fix, because the holder's own lookup returns its row before deleting it (see _Why This Works_). The regression test has to put another person's lookup in between. The adversarial review of the fix asked for it to assert that the other try really reached the library (session history): it expects `INVALID_OTP` on the other person's wrong code before it checks the holder ("still answers expired after another person's code is tried" in `apps/api/tests/auth/sign-in/sign-in-and-consent.test.ts`). Without that assertion, a change that stopped the other try short of the lookup would let the test pass for the wrong reason.

## Solution

Two parts, merged as #514 (Linear BA-34).

**1. Turn the library's deletion at lookup off** (the `verification` option in `apps/api/src/auth/auth.ts`):

```ts
    verification: { disableCleanup: true },
```

**2. Delete expired rows in the daily sweep pass instead, a day after they expire.** #514 put the delete in the api. It now lives in core, as one of the three deletes in `sweepIdentitySet`, beside expired sessions and rate-limit windows:

```ts
// packages/core/src/sweeps/index.ts
const VERIFICATION_KEPT_PAST_EXPIRY_MS = 24 * 60 * 60 * 1000;

const EXPIRED_VERIFICATIONS = "DELETE FROM verification WHERE expires_at < $1";

  verifications: await countDeleted(platform, door, EXPIRED_VERIFICATIONS, [
    before(input.now, VERIFICATION_KEPT_PAST_EXPIRY_MS),
  ]),
```

The day's grace lets a code that expired just before the sweep still read as spent. The pass in `apps/api/src/timers/sweeps.ts` runs `sweepIdentitySet` after the workspace sweeps, whether or not they succeeded; a pass skipped for a held lock skips it too. A refused delete becomes a refusal whose sweep is `verifications` and which names no workspace, and the pass's log line carries `verifications_deleted`, as does `the sweep pass failed` (`sweptOutsideAnyWorkspace` and `pass` in `sweeps.ts`). The delete covers every verification row more than a day past expiry, not only sign-in codes: links, OAuth state, trusted devices and the library's locks too. The runbook's "The daily sweeps" and §11 say so (`docs/operations/RUNBOOK.md`), and so does CONCEPTS.md's **sweep pass** entry.

## Why This Works

`findVerificationValue` reads the newest row for the identifier first (`internal-adapter.mjs`), then deletes every expired row in the whole table, then returns what it read. A person's own lookup therefore still sees their expired row, and `atomicVerifyOTP` answers `OTP_EXPIRED` (`apps/api/node_modules/better-auth/dist/plugins/email-otp/routes.mjs`).

The delete is table-wide, though, so a lookup from any other request, any person and any plugin removes that row too. The holder's next lookup finds nothing, so `existing` is null and the expiry branch is skipped. `consumeVerificationValue` then finds no row and returns null, and the answer is `INVALID_OTP` (`atomicVerifyOTP` in `email-otp/routes.mjs`). That is why the fault crossed requests and showed under concurrency, such as parallel browser workers sharing one api and one database.

With `disableCleanup: true` the row stays until the sweep pass, so the holder's lookup always finds it and answers `OTP_EXPIRED`.

The cost is that expiry no longer means the row is gone. Every reader now has to treat an expired row as absent by itself. `consumeVerificationValue` does: it returns null for a row past `expiresAt`, while still deleting it (`internal-adapter.mjs`). In 1.7.5 every lookup the api can reach compares `expiresAt` or ends in a consume (the audit below).

## Prevention

### The rule

With the deletion at lookup off, an expired row survives until the first sweep pass after it is a day past expiry: up to about two days, since a pass runs every 24 hours. Every reader of the `verification` table must compare `expiresAt` itself, or consume through `consumeVerificationValue` and refuse on null. A reader that checks only that the row exists now accepts a row that has expired.

Re-run this audit on every better-auth upgrade, on adding any Better Auth plugin, and on adding project code that reads the `verification` table:

```sh
cd apps/api
grep -rn "findVerificationValue(" node_modules/better-auth/dist node_modules/@better-auth/*/dist --include=*.mjs
grep -rln "consumeVerificationValue(" node_modules/better-auth/dist node_modules/@better-auth/*/dist --include=*.mjs
cd ../.. && grep -rn "FROM verification" apps/api/src packages/core/src
```

For each call to `findVerificationValue`, find its gate in the lines that follow: an `expiresAt` comparison, or a later consume whose null result refuses. In 1.7.5 the first command finds 12 sites. A new site, or a site whose gate has moved, is what the audit is for.

The api also clears the library's promotion lock by its name (_Fixed: an orphaned lock skipped one promotion_, below). `apps/api/tests/auth/promotion-lock.test.ts` fails if a release renames the lock or re-keys its reservation, which would otherwise make the clear delete nothing. When it fails, find the new name with:

```sh
grep -rn "revoke-unproven-account-access" apps/api/node_modules/better-auth/dist --include=*.mjs
```

The day's grace is load-bearing too. A sweep that deletes every expired row the moment it runs brings the bug back from the other side: a code that expired minutes before the pass would read as wrong. Any later housekeeping of the identity set keeps the grace, including the plan's U16 step, whose wording ("no expired identity-set row of these kinds remains") would drop it if built literally (the heading "U16. Identity-set housekeeping" in `docs/archive/plans/2026-10-01-2241-feat-people-sign-in-and-security-plan.md`).

### The 1.7.5 baseline

The api configures `jwt`, `organization`, `emailOTP`, `oauthProvider`, `twoFactor`, `passkey` and `cimd` (the `plugins` list in `createAuth` in `apps/api/src/auth/auth.ts`), and no `socialProviders`. Paths below are under `apps/api/node_modules/better-auth/dist/`.

| `findVerificationValue` site                                                    | Reached here                    | Gate                                                                                        |
| ------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------- |
| email-otp `getVerificationOTP`, `plugins/email-otp/routes.mjs`                  | yes                             | answers `{ otp: null }` when `expiresAt < now`                                              |
| email-otp `checkVerificationOTP`, `plugins/email-otp/routes.mjs`                | yes                             | `OTP_EXPIRED` when `expiresAt < now`                                                        |
| email-otp `atomicVerifyOTP` (sign-in), `plugins/email-otp/routes.mjs`           | yes                             | `OTP_EXPIRED` when expired, then a consume, null answers `INVALID_OTP`                      |
| email-otp `tryReuseOTP` (send again), `plugins/email-otp/otp-token.mjs`         | yes                             | null when expired, so a new code is made                                                    |
| two-factor trusted device, the `after` hook of `twoFactor` in `plugins/two-factor/index.mjs` | plugin configured               | `expiresAt > now`                                                                           |
| two-factor `verifyTwoFactor` with no session, `verify-two-factor.mjs`           | no: every verify path is closed | existence only; `valid()` consumes (latent, below)                                          |
| reset-password callback, `requestPasswordResetCallback` in `api/routes/password.mjs` | core route                      | `INVALID_TOKEN` when `expiresAt < now`                                                      |
| request-password-reset for an unknown email, `requestPasswordReset` in `api/routes/password.mjs` | core route                      | a dummy lookup against timing attacks; its result is discarded                              |
| `waitForCleanupLock`, `db/revoke-unproven-account-access.mjs`                   | from email-otp sign-in          | deletes the lock and returns when `expiresAt <= now`                                        |
| generic OAuth state, `parseGenericState` in `state.mjs`                         | no social sign-in configured    | gates on the expiry inside the state's own payload (`parsedData.expiresAt`), not the row's  |
| oauth-proxy, the `/sign-in/social` `after` hook of `oAuthProxy` in `plugins/oauth-proxy/index.mjs` | not configured                  | reads `.value` with no expiry comparison at the lookup; judge it before enabling            |
| phone-number, `verifyPhoneNumberOTP` in `plugins/phone-number/routes.mjs`       | not configured                  | `OTP_EXPIRED` when `expiresAt < now`                                                        |

Consumers through `consumeVerificationValue`, gated by its expiry check in `internal-adapter.mjs`: passkey (`verifyPasskeyRegistration` and `verifyPasskeyAuthentication` in `apps/api/node_modules/@better-auth/passkey/dist/index.mjs`) and the oauth-provider's authorization code (`checkVerificationValue` in `apps/api/node_modules/@better-auth/oauth-provider/dist/introspect-njKASm3q.mjs`; the file name is a build hash, so grep rather than trust it). Inside better-auth, `magic-link`, `phone-number`, `one-time-token`, `siwe`, `email-otp`, two-factor's verify and `otp`, `api/routes/password.mjs` and `api/routes/update-user.mjs` also call `consumeVerificationValue`. `@better-auth/cimd` 1.7.5 neither looks up nor consumes a verification row.

The project's own reads gate too. `READ_A_LINK` computes `link_live` and `code_live` as `expires_at > now()` (`apps/api/src/auth/sign-in/sign-in-link.ts`), and `linkSeen` refuses a link unless both are live (`apps/api/src/auth/sign-in/link-token.ts`). Erasure finds and deletes a person's verification rows by identifier whatever their expiry (the `identity-verification` descriptor in `packages/core/src/erasure/map.ts`, `VERIFICATIONS` in `packages/core/src/erasure/routine/identity.ts`), so a row kept for its day is still erased on request. The promotion-lock clear deletes a lock only once `expires_at <= now` (`apps/api/src/auth/promotion-lock.ts`).

### Latent: two-factor's no-session branch

`verifyTwoFactor` checks only that the challenge row exists (`verify-two-factor.mjs`) before it reads the user and carries on. Its `valid()` step consumes through `consumeVerificationValue`, so an expired challenge never mints a session, but the steps before it run against an expired row. This is unreachable today. Every `/two-factor/verify-*` path is in `CLOSED_FACTOR_PATHS` (`apps/api/src/auth/closed-paths.ts`). The api calls `verifyTOTP` as a server function in two places (`apps/api/src/auth/second-factor/authenticator.ts`, `confirm.ts`), but only behind `fenced.asThePerson`, which demands a session, so the library takes its session branch. Nothing calls `verifyOTP` or `verifyBackupCode`. Before opening any of those paths, or calling one without a session, add an expiry check in front of it.

### Fixed: an orphaned lock skipped one promotion

`revokeUnprovenAccountAccess` reserves a five-second lock row (`cleanupLockExpiresInMs` in `db/revoke-unproven-account-access.mjs`) and deletes it in `finally`, swallowing a failed delete. The reservation's id is a hash of `"reserve:" + identifier` (`reserveVerificationValue` in `internal-adapter.mjs`), so a lock left behind, by a failed delete or a process killed mid-revocation, makes the next reservation for that user return `false` (the `catch` in `reserveVerificationValue`). The caller then waits, finds the lock expired, deletes it and returns `findUserById` without revoking the unproven accounts and sessions or setting `emailVerified` (`waitForCleanupLock` and `revokeUnprovenAccountAccess` in `revoke-unproven-account-access.mjs`). Email-otp sign-in goes on to sign in as that user (`signInEmailOTP` in `plugins/email-otp/routes.mjs`). The person stays unverified, so accepting an invitation is refused (`refusalAgainst` in `packages/core/src/members/invitations/accepting.ts`) until a later email-code sign-in revokes as it should. It bites only for a user whose `emailVerified` is still false.

Before #514 an orphaned lock lasted about five seconds. The person's own retry looked up their code (`atomicVerifyOTP` in `plugins/email-otp/routes.mjs`) before it reached the reservation, and that lookup's table-wide delete removed the expired lock. With the deletion at lookup off, the lock stayed until a sign-in used it up or the sweep pass removed it, up to about two days.

The api now clears it first (Linear BA-39). A `hooks.before` on `/sign-in/email-otp` in `apps/api/src/auth/auth.ts`, which the sign-in link reaches too, deletes the signing-in person's lock when they are unverified and the lock has expired (`apps/api/src/auth/promotion-lock.ts`). A live lock stays, so a second sign-in during a promotion still waits. A failed clear is a warning, `auth.promotion_lock_not_cleared`, and the sign-in goes on as it did before the fix.

### Tests that hold it

- `apps/api/tests/auth/sign-in/sign-in-and-consent.test.ts`, "still answers expired after another person's code is tried". It ages the holder's code, has another person try a wrong code, asserts that try reached the library, then expects `OTP_EXPIRED` for the holder. Turn the deletion at lookup back on and it fails.
- `apps/api/tests/timers/sweeps.test.ts`, "deletes codes over a day expired, keeping later ones", pins the day's grace to the minute either side and the `verifications_deleted` count.
- `apps/web/e2e/auth/sign-in.spec.ts`, "an expired code reads as spent, handing focus to another", proves the spent reading through the browser.
- `apps/api/tests/auth/promotion-lock.test.ts` seeds an orphaned lock under the library's reservation id on a person holding a session and an account, then signs in by code and by link and expects both gone and the address proven. Remove the hook and those tests fail. The same file pins the library's lock name and reservation key.

### When Better Auth changes

If a release stops deleting expired rows at lookup (read `findVerificationValue` in `dist/db/internal-adapter.mjs` of the installed version), the reason for `disableCleanup` is gone; the sweep pass still keeps the table small. If the api ever turns the deletion back on, the first test above fails and the bug returns, and this doc's audit rule no longer applies.

Read against 1.7.7 on 11/10/2026 (BA-147): `dist/db/internal-adapter.mjs` is byte for byte 1.7.5's, so the deletion at lookup is still there and this doc stands. The baseline is still 1.7.5's, and five of the files it cites changed (`plugins/email-otp/routes.mjs`, `api/routes/password.mjs`, `state.mjs`, `plugins/oauth-proxy/index.mjs`, `plugins/phone-number/routes.mjs`), so find a site by its name. 1.7.7 adds one `findVerificationValue` site, `magicLinkVerify` in `plugins/magic-link/index.mjs`, in a plugin the api does not configure. Generic OAuth state and oauth-proxy now look their rows up under an `auth-state:` prefix.

## Related Issues

- Linear BA-34, merged as #514. Linear BA-39 cleared the orphaned promotion lock that #514 had lengthened.
- `docs/solutions/best-practices/better-auth-closed-endpoints-run-as-server-functions-without-router-guards.md`: another Better Auth 1.7.5 behaviour that differs from what the config suggests, and the record of the closed factor paths that keep two-factor's no-session branch latent.
- `docs/solutions/architecture-patterns/adr-0009.md`: Better Auth runs in-process as the api's identity provider, which is why its `verification` table sits in the api's Postgres and the api's sweep pass can delete from it.
- `docs/plans/2026-10-01-2241-feat-people-sign-in-and-security-plan.md`, U16 (identity-set housekeeping): must keep the day's grace.
- `CONCEPTS.md`, **sweep pass**; `docs/operations/RUNBOOK.md`, "The daily sweeps" and §11.
