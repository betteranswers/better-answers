---
title: "Better Auth's lookup deleted every expired code, so a person's just-expired sign-in code read as wrong rather than spent"
date: 2026-10-02
category: logic-errors
module: apps/api
problem_type: logic_error
component: identity
symptoms:
  - "A person typing a just-expired email code got INVALID_OTP, which the sign-in screen reads as 'That code is wrong.' with tries left, instead of OTP_EXPIRED, which it reads as spent"
  - "It happened only when another request looked up a verification row between the code's expiry and its holder's try; the holder's own lookup alone answered OTP_EXPIRED"
  - "The expired-code spec in apps/web/e2e/sign-in.spec.ts was flaky under parallel Playwright workers, because other workers' sign-ins deleted the aged code"
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

Better Auth 1.7.5 deletes every expired row in its `verification` table each time `findVerificationValue` runs, unless `verification.disableCleanup` is set (`apps/api/node_modules/better-auth/dist/db/internal-adapter.mjs:753-757`). So any person's sign-in deleted every other person's sign-in code once it had expired. A person who then typed their own just-expired code was told it was wrong, with tries left, instead of that it was spent.

That table is the library's store of short-lived tokens: sign-in codes and links, OAuth state, trusted devices and locks. It is not the glossary's _verification_, which is the platform's check of a concept or a composition.

## Symptoms

- After someone else had tried a code, a person typing a code just past its expiry got `400 INVALID_OTP` rather than `400 OTP_EXPIRED`. The sign-in screen showed "That code is wrong. Check it and try again. 2 tries left." (`apps/web/src/features/auth/refusal-words.ts:107-113`) instead of "That code can't be used any more." (`refusal-words.ts:100-103`). The screen reads a code as spent only on a 403 or `OTP_EXPIRED` (`apps/web/src/features/auth/code-entry.ts:15-23`).
- Every later try was refused as wrong as well, so the screen counted tries down for a code the database no longer held.
- On its own, the same code read correctly as expired. The fault needed another request's lookup between the expiry and the holder's try.
- The browser spec "an expired code reads as spent, handing focus to another" (`apps/web/e2e/sign-in.spec.ts:506`) was flaky under parallel Playwright workers: another worker's sign-in deleted the aged code before the spec typed it.

## What Didn't Work

No fix attempt failed. The defect surfaced while the expired-code browser spec was being built, and reading `findVerificationValue` in the installed library settled the cause (session history). Two approaches look sufficient and are not:

- **Reading the answer differently in the browser.** The web layer already reads `OTP_EXPIRED` as spent, because the library deletes a code as it reports it expired (`apps/web/src/features/auth/code-entry.ts:17-18`). That cannot help here. The row was gone before the holder's first try, so the server's first answer was already `INVALID_OTP`, and no client mapping can tell that from a wrong code.
- **Testing the expired code alone.** A test that ages one person's code and types it passes with or without the fix, because the holder's own lookup returns its row before deleting it (see _Why This Works_). The regression test has to put another person's lookup in between. The adversarial review of the fix asked for it to assert that the other try really reached the library (session history): it expects `INVALID_OTP` on the other person's wrong code before it checks the holder (`apps/api/tests/sign-in-and-consent.test.ts:154-158`). Without that assertion, a change that stopped the other try short of the lookup would let the test pass for the wrong reason.

## Solution

Two parts, merged as #514 (Linear BA-34).

**1. Turn the library's deletion at lookup off** (`apps/api/src/auth/auth.ts:428-432`):

```ts
    /**
     * The library's lookup deletes every expired row, so another person's sign-in would make a
     * code just expired read as wrong. The daily sweep deletes them.
     */
    verification: { disableCleanup: true },
```

**2. Delete expired rows in the api's daily sweep pass instead, a day after they expire.**

```ts
// apps/api/src/auth/constants.ts:20-24
/**
 * Past any wait to type a code from an email, so one that expired just before the daily sweep
 * still reads as spent.
 */
export const VERIFICATION_KEPT_PAST_EXPIRY_SECONDS = 24 * 60 * 60;

// apps/api/src/auth/expired-verifications.ts:7-13
export const dropExpiredVerifications = async (door: PostgresDoor, now: Date): Promise<number> => {
  const keptFrom = new Date(now.getTime() - VERIFICATION_KEPT_PAST_EXPIRY_SECONDS * 1000);
  const dropped = await withIdentityWrite(IDENTITY_PRINCIPAL, door, (tx) =>
    tx.query("DELETE FROM verification WHERE expires_at < $1", [keptFrom]),
  );
  return dropped.rowCount ?? 0;
};
```

`apps/api/src/sweeps.ts:48-54` wraps it, and the pass runs it after the workspace sweeps, whether or not they succeeded; a pass skipped for a held lock skips it too (`sweeps.ts:77-82`). A refused delete becomes a refusal whose sweep is `verifications` and which names no workspace, and the pass's log line carries `verifications_deleted` (`sweeps.ts:92-98`), as does `the sweep pass failed` (`sweeps.ts:83-90`). The delete covers every verification row more than a day past expiry, not only sign-in codes: links, OAuth state, trusted devices and the library's locks too. The runbook's "The daily sweeps" and §11 say so (`docs/operations/RUNBOOK.md`), and so does CONTEXT.md's **sweep pass** entry.

## Why This Works

`findVerificationValue` reads the newest row for the identifier first (`internal-adapter.mjs:751-752`), then deletes every expired row in the whole table (`:753-757`), then returns what it read (`:758`). A person's own lookup therefore still sees their expired row, and `atomicVerifyOTP` answers `OTP_EXPIRED` (`apps/api/node_modules/better-auth/dist/plugins/email-otp/routes.mjs:763-766`).

The delete is table-wide, though, so a lookup from any other request, any person and any plugin removes that row too. The holder's next lookup finds nothing, so `existing` is null and the expiry branch is skipped. `consumeVerificationValue` then finds no row and returns null, and the answer is `INVALID_OTP` (`email-otp/routes.mjs:768-769`). That is why the fault crossed requests and showed under concurrency, such as parallel browser workers sharing one api and one database.

With `disableCleanup: true` the row stays until the sweep pass, so the holder's lookup always finds it and answers `OTP_EXPIRED`.

The cost is that expiry no longer means the row is gone. Every reader now has to treat an expired row as absent by itself. `consumeVerificationValue` does: it returns null for a row past `expiresAt`, while still deleting it (`internal-adapter.mjs:856`). In 1.7.5 every lookup the api can reach compares `expiresAt` or ends in a consume (the audit below).

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

For each `findVerificationValue` hit, find its gate in the lines that follow: an `expiresAt` comparison, or a later consume whose null result refuses. In 1.7.5 the first command finds 12 sites. A new site, or a site whose gate has moved, is what the audit is for.

The api also clears the library's promotion lock by its name (_Fixed: an orphaned lock skipped one promotion_, below). `apps/api/tests/promotion-lock.test.ts` fails if a release renames the lock or re-keys its reservation, which would otherwise make the clear delete nothing. When it fails, find the new name with:

```sh
grep -rn "revoke-unproven-account-access" apps/api/node_modules/better-auth/dist --include=*.mjs
```

The day's grace is load-bearing too. A sweep that deletes every expired row the moment it runs brings the bug back from the other side: a code that expired minutes before the pass would read as wrong. Any later housekeeping of the identity set keeps the grace, including the plan's U16 step, whose wording ("no expired identity-set row of these kinds remains") would drop it if built literally (`docs/plans/2026-10-01-2241-feat-people-sign-in-and-security-plan.md:909-923`).

### The 1.7.5 baseline

The api configures `jwt`, `organization`, `emailOTP`, `oauthProvider`, `twoFactor`, `passkey` and `cimd` (`apps/api/src/auth/auth.ts:490-633`), and no `socialProviders`. Paths below are under `apps/api/node_modules/better-auth/dist/`.

| `findVerificationValue` site                                                    | Reached here                    | Gate                                                                                        |
| ------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------- |
| email-otp `getVerificationOTP`, `plugins/email-otp/routes.mjs:186-187`          | yes                             | answers `{ otp: null }` when `expiresAt < now`                                              |
| email-otp `checkVerificationOTP`, `plugins/email-otp/routes.mjs:239-244`        | yes                             | `OTP_EXPIRED` when `expiresAt < now`                                                        |
| email-otp `atomicVerifyOTP` (sign-in), `plugins/email-otp/routes.mjs:763-769`   | yes                             | `OTP_EXPIRED` when expired, then a consume, null answers `INVALID_OTP`                      |
| email-otp `tryReuseOTP` (send again), `plugins/email-otp/otp-token.mjs:44-45`   | yes                             | null when expired, so a new code is made                                                    |
| two-factor trusted device, `plugins/two-factor/index.mjs:258-259`               | plugin configured               | `expiresAt > now`                                                                           |
| two-factor `verifyTwoFactor` with no session, `verify-two-factor.mjs:19-20`     | no: every verify path is closed | existence only; `valid()` consumes at `:26` (latent, below)                                 |
| reset-password callback, `api/routes/password.mjs:125-126`                      | core route                      | `INVALID_TOKEN` when `expiresAt < now`                                                      |
| request-password-reset for an unknown email, `api/routes/password.mjs:66`       | core route                      | a dummy lookup against timing attacks; its result is discarded                              |
| `waitForCleanupLock`, `db/revoke-unproven-account-access.mjs:10-15`             | from email-otp sign-in          | deletes the lock and returns when `expiresAt <= now`                                        |
| generic OAuth state, `state.mjs:120`                                            | no social sign-in configured    | gates on the expiry inside the state's own payload (`state.mjs:141`), not the row's         |
| oauth-proxy, `plugins/oauth-proxy/index.mjs:359`                                | not configured                  | reads `.value` with no expiry comparison at the lookup; judge it before enabling            |
| phone-number, `plugins/phone-number/routes.mjs:496-501`                         | not configured                  | `OTP_EXPIRED` when `expiresAt < now`                                                        |

Consumers through `consumeVerificationValue`, gated by `internal-adapter.mjs:856`: passkey (`apps/api/node_modules/@better-auth/passkey/dist/index.mjs:343` and `:459`) and the oauth-provider's authorization code (`apps/api/node_modules/@better-auth/oauth-provider/dist/introspect-njKASm3q.mjs:1895`; the file name is a build hash, so grep rather than trust it). Inside better-auth, `magic-link`, `phone-number`, `one-time-token`, `siwe`, `email-otp`, two-factor's verify and `otp`, `api/routes/password.mjs` and `api/routes/update-user.mjs` also call `consumeVerificationValue`. `@better-auth/cimd` 1.7.5 neither looks up nor consumes a verification row.

The project's own reads gate too. `READ_A_LINK` computes `link_live` and `code_live` as `expires_at > now()` (`apps/api/src/auth/sign-in-link.ts:74-76`), and `linkSeen` refuses a link unless both are live (`apps/api/src/auth/link-token.ts:141-157`). Erasure finds and deletes a person's verification rows by identifier whatever their expiry (`packages/core/src/erasure/map.ts:162-173`, `packages/core/src/erasure/identity.ts:63-66`), so a row kept for its day is still erased on request. The promotion-lock clear deletes a lock only once `expires_at <= now` (`apps/api/src/auth/promotion-lock.ts`).

### Latent: two-factor's no-session branch

`verifyTwoFactor` checks only that the challenge row exists (`verify-two-factor.mjs:19-20`) before it reads the user and carries on. Its `valid()` step consumes through `consumeVerificationValue` (`:26`), so an expired challenge never mints a session, but the steps before it run against an expired row. This is unreachable today. Every `/two-factor/verify-*` path is in `CLOSED_FACTOR_PATHS` (`apps/api/src/auth/auth.ts:151-167`), and nothing in `apps/api/src` calls `verifyTOTP`, `verifyOTP` or `verifyBackupCode` as a server function. Before opening any of those paths, or calling one as a server function, add an expiry check in front of it.

### Fixed: an orphaned lock skipped one promotion

`revokeUnprovenAccountAccess` reserves a five-second lock row (`db/revoke-unproven-account-access.mjs:3`, `:35-39`) and deletes it in `finally`, swallowing a failed delete (`:53-55`). The reservation's id is a hash of `"reserve:" + identifier` (`internal-adapter.mjs:885`), so a lock left behind, by a failed delete or a process killed mid-revocation, makes the next reservation for that user return `false` (`internal-adapter.mjs:902-909`). The caller then waits, finds the lock expired, deletes it and returns `findUserById` without revoking the unproven accounts and sessions or setting `emailVerified` (`revoke-unproven-account-access.mjs:7-15`, `:42-45`). Email-otp sign-in goes on to sign in as that user (`plugins/email-otp/routes.mjs:432-436`). The person stays unverified, so accepting an invitation is refused (`packages/core/src/members/accepting.ts:126`) until a later email-code sign-in revokes as it should. It bites only for a user whose `emailVerified` is still false.

Before #514 an orphaned lock lasted about five seconds. The person's own retry looked up their code (`plugins/email-otp/routes.mjs:763`) before it reached the reservation, and that lookup's table-wide delete removed the expired lock. With the deletion at lookup off, the lock stayed until a sign-in used it up or the sweep pass removed it, up to about two days.

The api now clears it first (Linear BA-39). A `hooks.before` on `/sign-in/email-otp` in `apps/api/src/auth/auth.ts`, which the sign-in link reaches too, deletes the signing-in person's lock when they are unverified and the lock has expired (`apps/api/src/auth/promotion-lock.ts`). A live lock stays, so a second sign-in during a promotion still waits. A failed clear is a warning, `auth.promotion_lock_not_cleared`, and the sign-in goes on as it did before the fix.

### Tests that hold it

- `apps/api/tests/sign-in-and-consent.test.ts:139-160`, "still answers expired after another person's code is tried". It ages the holder's code, has another person try a wrong code, asserts that try reached the library, then expects `OTP_EXPIRED` for the holder. Turn the deletion at lookup back on and it fails.
- `apps/api/tests/sweeps.test.ts:245-257`, "deletes codes over a day expired, keeping later ones", pins the day's grace to the minute either side and the `verifications_deleted` count.
- `apps/web/e2e/sign-in.spec.ts:506`, "an expired code reads as spent, handing focus to another", proves the spent reading through the browser.
- `apps/api/tests/promotion-lock.test.ts` seeds an orphaned lock under the library's reservation id on a person holding a session and an account, then signs in by code and by link and expects both gone and the address proven. Remove the hook and those tests fail. The same file pins the library's lock name and reservation key.

### When Better Auth changes

If a release stops deleting expired rows at lookup (read `findVerificationValue` in `dist/db/internal-adapter.mjs` of the installed version), the reason for `disableCleanup` is gone; the sweep pass still keeps the table small. If the api ever turns the deletion back on, the first test above fails and the bug returns, and this doc's audit rule no longer applies.

## Related Issues

- Linear BA-34, merged as #514. Linear BA-39 cleared the orphaned promotion lock that #514 had lengthened.
- `docs/solutions/best-practices/better-auth-closed-endpoints-run-as-server-functions-without-router-guards.md`: another Better Auth 1.7.5 behaviour that differs from what the config suggests, and the record of the closed factor paths that keep two-factor's no-session branch latent.
- `docs/solutions/architecture-patterns/adr-0009-better-auth-in-process-identity-provider.md`: Better Auth runs in-process as the api's identity provider, which is why its `verification` table sits in the api's Postgres and the api's sweep pass can delete from it.
- `docs/plans/2026-10-01-2241-feat-people-sign-in-and-security-plan.md`, U16 (identity-set housekeeping): must keep the day's grace.
- `CONTEXT.md`, **sweep pass**; `docs/operations/RUNBOOK.md`, "The daily sweeps" and §11.
