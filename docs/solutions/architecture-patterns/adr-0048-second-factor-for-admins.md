---
title: "An Admin or the operator confirms a second factor before anything else, by a gate derived on every request"
date: 2026-10-03
module: packages/core
problem_type: architecture_pattern
component: identity
severity: high
applies_when:
  - "Adding a tRPC procedure, an api route or a Better Auth plugin endpoint a signed-in browser reaches"
  - "Adding an act that makes a person an Admin or the operator, or removes a second factor"
  - "Changing what a session's confirmation stamp, pending clock or setup grant means"
  - "Signing an Admin or the operator in from a test suite, the browser suite or the journeys"
tags:
  - adr-0048
  - second-factor
  - pending-session
  - pending-set
  - promotion
  - better-auth
  - identity-set
---

# An Admin or the operator confirms a second factor before anything else, by a gate derived on every request

## The decision

A person who is an Admin in any workspace, and the operator, must hold a second factor: a passkey, or an authenticator past its first code. A session of such a person that has not confirmed one it still holds is *pending*. A pending session reaches the pending set and nothing else.

- **The predicate is pure and in the kernel:** `standingOf` in `packages/core/src/kernel/second-factor.ts` turns four facts into `not-required`, `confirmed`, `confirm` or `setup`. A stamp counts only while the person holds a factor, so someone made an Admin after removing their last one sets one up.
- **The pending set is one declared table of steps,** `PENDING_SET`: reading the session, signing out, reading one's own second factor and the operator standing, confirming, spending a recovery code, giving the restore code, and setting a factor up. Setup is open only to a session with nothing to confirm with, or one a spent code granted. A mailbox alone never adds a factor beside the person's own.
- **One read judges a session:** `judgeTheSession` in `packages/core/src/workspaces/session-standing.ts`. It derives the standing afresh, so a role change, a removed factor or a restore takes effect on the next request; nothing pending is stored.
- **The pending hour is a clock, not a state.** The first pending read sets `session.pending_since`. A read past the hour ends the session, and the daily sweep ends one nobody read, both by `PENDING_SESSION_LIFETIME_MS`. A read that finds the session no longer pending clears the clock. The read skips a row another transaction holds, never waiting on it.
- **The gate stands at every root a browser reaches:**
  - tRPC's session read (`gatedReader` in `apps/api/src/second-factor-gate.ts`), which every procedure passes through;
  - `/me` and `/consent`; a pending session's consent is sent to confirm, its signed query kept;
  - the api's own factor routes, each naming its step;
  - a Better Auth before-hook over every endpoint reached over HTTP, outside the steps above and the paths that act on no session (`SESSIONLESS_LIBRARY_PATHS`). The api's server-function calls are gated by the routes that make them;
  - the OAuth post-login rule, which sends a pending session's authorize to the post-login page, so no code is issued until it confirms. `/oauth2/continue` and `/oauth2/consent` refuse it.
- **The refusal has its own word,** `second-factor-pending`, in the `precondition` class. Signing in again would only meet it again, so the SPA sends the person to confirm or setup, never to sign-in.
- **`/get-session` answers a pending session without renewing it.**
- **Becoming an Admin or the operator is a promotion.** Each act that makes a person one, from needing no factor, clears every session's confirmation and pending clock in its own transaction, and marks the person (`user.promoted_at`) until they first confirm. The confirm page then lists every credential that can confirm, by name and date. The tRPC acts mail the same list once they commit: a role move, a bulk role move and an Admin invitation accepted.
- **A confirmation does not outlive its factor.** Removing a passkey or the authenticator clears the confirmation of the person's other sessions; the session that removed it keeps its own.
- **Tests sign in past the gate by the harness's own writes,** never by weakening it. The api suites' `signIn` gives a person who must hold a factor an authenticator if they hold none and stamps the session. The browser suite confirms through the real confirm page with an authenticator the harness writes. The gate's own tests sign in by email alone.

## Why

- Better Auth's two-factor plugin intercepts only its password sign-in. Email-code, passkey and social sign-in mint a whole session, so the gate has to be ours.
- Who must hold a factor is policy, and `apps/api` holds transports only, so the predicate lives in the kernel and each transport names its paths for the steps.
- A stored *pending* state goes stale the moment a role changes elsewhere. Deriving the standing per request makes a promotion, a demotion and a removal take effect at once.
- The pending clock bounds a session that holds only the mailbox: an hour after anyone sees it pending, it is gone, and a session from before the switch is not deleted on sight.
- Sending the post-login page on, rather than refusing `/oauth2/authorize`, keeps the "connect Claude" flow's signed query whole, and the oauth plugin resumes authorize inside the sign-in request, where a refusal would become the sign-in's answer.
- A promotion must make the next request pending even when the session was stamped as a Viewer by a passkey. Clearing the stamps in the promoting act does that; the mark carries the promotion block until the first confirmation.
- A stamp records no factor. Removing a factor because it was lost or stolen must not leave a session it confirmed standing.

## Rejected

- Turning on the two-factor plugin's own flow: it covers password sign-in alone, and its verify mints a new session.
- A `pending` column: stale on any change made elsewhere.
- Comparing each stamp against a promotion instant instead of clearing stamps at promotion: a first confirmation could not clear the mark without old stamps counting again.
- Refusing `/oauth2/authorize` in the before-hook: it breaks the sign-in that resumes it.
- Keeping a confirmation after its factor is removed: the conservative answer is that a stamp does not outlive what may have made it.
- A grace period before an Admin must set up a factor: the owner chose none (R14).
