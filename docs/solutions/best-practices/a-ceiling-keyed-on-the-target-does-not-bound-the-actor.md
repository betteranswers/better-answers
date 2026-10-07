---
title: "A ceiling keyed on the target does not bound the actor spending a shared resource"
date: 2026-10-02
category: best-practices
module: packages/core
problem_type: best_practice
component: identity
severity: high
applies_when:
  - "Adding a ceiling to an action that sends email or spends another resource every workspace shares, such as invitations, access-request emails, sharing or notifications"
  - "Choosing the key a ceiling counts under, or citing a ceiling in a plan's risk row as the guard against flooding a shared resource"
  - "Letting one call fan out to many targets, such as an N-address send, under a ceiling keyed per target"
  - "Adding a second ceiling to an action that already counts one in its own transaction: the lock order of the counter keys, and how the counters' keys stay apart"
  - "Choosing where a tenant's counter is stored: a workspace-keyed table under row-level security, not the exempt pre-workspace counter"
  - "Writing the words shown when a CeilingMet 429 can come from more than one ceiling and the 429 does not say which"
symptoms:
  - "The plan's risk row cited a per-address ceiling (5 invitation emails per address per workspace per hour) as the guard against flooding the shared mail relay"
  - "The ceiling stopped only repeats to one address; the security review estimated that, at 50 distinct addresses a call and 120 tRPC requests a minute per IP, one compromised Admin could ask for at least 6,000 invitation emails a minute"
  - "Every one of those emails would go through the one Resend account that also carries every workspace's sign-in codes, so a flood risked its suspension for every workspace"
root_cause: logic_error
resolution_type: code_fix
related_components:
  - kernel
  - stores
  - transports
  - web
tags:
  - rate-limit
  - ceiling
  - ceiling-met
  - shared-resource
  - row-level-security
  - email
  - invitations
  - people
  - resend
---

# A ceiling keyed on the target does not bound the actor spending a shared resource

## Context

The people layout rework lets an Admin invite up to 50 addresses in one action, and Bulk Resend and Cancel take up to 50 rows (`docs/plans/2026-10-01-1807-feat-people-layout-rework-plan.md:313`; `MOST_AT_ONCE = 50` at `packages/core/src/members/invitations.ts:41`, enforced by the addresses schema at `invitations.ts:54` and the rows schema at `packages/core/src/members/invitation-bulk.ts:45`).

KTD11 of that plan set a ceiling on invitation emails: "A per-address ceiling, counted by workspace, covers every invitation email: Invite, single-row Resend and bulk Resend" (plan line 314). In code it is `INVITATION_CEILING`, at most 5 emails an hour to one address from one workspace (`packages/core/src/members/invitation-ceilings.ts:10`). Its key is a hash of `workspaceId:address` (`counterKeyOf`, `invitation-ceilings.ts:15-17`). It is counted inside the action's own transaction. Past it the action fails with `CeilingMet`, and tRPC's `crossing` answers 429 through `throttled` (`apps/api/src/trpc/base.ts:101-109`, `:123`).

The plan's risk table then cited that ceiling against a different risk: "A send of up to 50 addresses floods the shared mail relay | KTD11's per-address ceiling, the 50 caps, and sends a few at a time." (plan line 431).

The code review's security reviewer showed the ceiling does not cover that risk. Its key names the address, so it stops a workspace emailing one address again and again. It does nothing about a workspace emailing many different addresses once each. The review's estimate: 50 distinct addresses a call, times the 120 requests to `/trpc` a minute one IP may make (`TRPC_IP_RULE = { windowMs: 60_000, max: 120 }` at `apps/api/src/auth/constants.ts:49`, applied per IP at `apps/api/src/trpc/mount.ts:27`), is 50 x 120 = about 6,000 invitation emails a minute that one compromised Admin could ask the api to send. That is a floor: the rule counts HTTP requests, and a batched tRPC request can carry several invite calls. The per-address ceiling refuses none of them.

That reaches past the one workspace. Every workspace mails through one Resend account. The api builds one sender over one paced transport per process (`apps/api/src/main.ts:37-38`, `pacedTransport` at `apps/api/src/smtp.ts:14-15`), and the same sender carries sign-in codes (`emailSender`'s doc, `smtp.ts:27`). The workspace ceiling's own doc states the risk: "Every workspace mails through one shared account, which a flood could get suspended" (`invitation-ceilings.ts:12`). A suspended account would stop every workspace's sign-in codes, not only the flooding workspace's invitations.

The fix is on PR #511, unmerged as of this writing.

## Guidance

**Ask what a ceiling's key bounds: the target, or the actor spending the shared resource.**

A ceiling counts against a key, and the key decides what it bounds. A key that names the target (an address, a person being emailed, a document) bounds what reaches that one target. It does not bound the actor, who can spread across as many targets as the input allows. When the risk is an actor spending a shared resource (a mail account's send limit and standing, a metered third-party API, a model budget), bound the actor too: key a ceiling on the actor, or on the narrowest scope that holds the actor. For invitations that scope is the workspace.

Keep the target's ceiling as well. It protects a recipient from being pestered. The two ceilings answer different risks, and neither stands in for the other.

When a plan's risk row cites a ceiling as its mitigation, check that the ceiling's key bounds the risk the row names. KTD11's ceiling was right for repeat emails and was cited against volume.

The repo already has an actor-keyed ceiling elsewhere: `personCeiling` keys its count on the calling person, `${path}:${ctx.personId}` (`apps/api/src/trpc/base.ts:278-294`).

**The shape this repo used (on PR #511).** `emailsCounted` counts two kinds of counter in one pass, inside the action's own transaction (`invitation-ceilings.ts:36-51`), built by `countersOf` (`:24-34`):

- one per address: `INVITATION_CEILING`, 5 an hour, amount 1 each (`:10`, `:28-32`);
- one per workspace: `WORKSPACE_INVITATION_CEILING`, 200 an hour, amount N for an N-address send (`:13`, `:33`).

Four details carry the weight.

1. **One sorted pass, so the lock order stays deadlock-free.** Each count is an upsert into the workspace's own rows of `invitation_email_counter` (`consumeInvitationEmails`, `packages/core/src/store/postgres/index.ts:525-546`), and the counter row "stays held until it commits" (its doc, `index.ts:521-524`). Two actions that share counters must take them in one order, or they can deadlock. `emailsCounted` puts every counter, the workspace's with the addresses', through one sort by key before it counts any (`invitation-ceilings.ts:43-47`). Counters also come before any invitation row an action holds (`waitingCounted`'s doc, `invitation-ceilings.ts:56`). The test "takes two crossing sends' counters in one order" (`packages/core/test/invitation-sets.test.ts:336`) guards the order; why a race test must be held at the first counter to prove it is the subject of a sibling learning (see Related).

2. **Count N for an N-item action.** `consumeInvitationEmails` takes an `amount` (`index.ts:531`). The upsert adds it: `count = invitation_email_counter.count + EXCLUDED.count` (`index.ts:542`). One send to 50 addresses counts 50 against the workspace, not 1. Counting calls instead of emails would let 200 calls of 50 through. The check is `count <= rule.max` after the add (`outcome`, `index.ts:460`), so a workspace at 160 that sends 50 is refused. The action fails whole: `sentUnderLocks` counts before it reads members or mints anything (`invitations.ts:311-319`), and the action's transaction rolls the count back (`index.ts:521-524`). The test "refuses a workspace's 201st email until the next hour" (`packages/core/test/invitations.test.ts:422`) holds the workspace ceiling.

3. **Keys that cannot collide, in a table that holds the tenant.** Both kinds of counter live in `invitation_email_counter`, keyed by workspace, key and hour, under row-level security with the workspace-isolation policy (`packages/schema/src/counter-tables.ts`, migration `0061_the-invitation-email-counter.sql`). An address key is sha256 of `` `${admin.workspaceId}:${address}` `` (`counterKeyOf`, `invitation-ceilings.ts:15-17`), so no two workspaces share one. The workspace's key is the fixed word `workspace` (`WORKSPACE_KEY`, `:19-20`): the row already names its workspace, no hex digest spells the word, so it cannot meet an address's key, and every address key sorts before it. Hashing also keeps addresses out of the counter table (`:15`). When two kinds of counter share a table, make their keys disjoint by construction, and say why beside the key. The counters began in the RLS-exempt `ingress_counter`, under one `invitation` scope with the workspace hashed into each key; review moved them, since a key that names a tenant does not isolate one. Keep a tenant's counters in a table under row-level security, and leave the exempt counter to what runs before any workspace exists.

4. **The words shown when a ceiling is met name both ceilings.** `CeilingMet` carries only `retryAfterSeconds` (`packages/core/src/kernel/ceiling.ts:2-3`), and the tRPC error formatter adds only that to the error's data (`apps/api/src/trpc/base.ts:165-166`). So the 429 does not say which ceiling was met. Words that blamed an address alone would send an Admin removing addresses to no effect. The web's words name both (`invitationsCeiling`, `apps/web/src/features/people/refusal-words.ts:94-101`).

**Pacing at the transport is a different layer.** The api sends all its email through one pooled nodemailer transport, paced at 5 a second (`EMAILS_PER_SECOND = 5` at `smtp.ts:12`; `rateDelta: 1000` and `rateLimit` at `smtp.ts:21-22`). The pace sits under Resend's ten a second per team, which its SMTP relay shares (`smtp.ts:8-11`). Pacing smooths bursts so the relay does not refuse sends. It does not bound volume: at 5 a second a flood still drains at 18,000 emails an hour per process, and everything else the api sends waits behind it. Only a ceiling keyed on the actor refuses a flood at the action.

## Why This Matters

- A ceiling cited against the wrong risk hides the gap. The plan's risk row read as covered, so the flood went unexamined until the security review.
- The resource is shared across tenants. One compromised Admin in one workspace could cost every workspace its sign-in codes. The blast radius is the platform, not the workspace.
- No test fails to show the gap. The per-address ceiling did what it was written to do, and its tests passed. Only asking what its key bounds finds it.
- The fix is small when made at the start: one more counter in the same pass, an `amount`, and one sentence of words. After a suspension it is an incident.

## When to Apply

Any action that sends email, or spends another shared resource, on an actor's say-so. For example:

- invitations: Invite, Resend and bulk Resend (fix on PR #511, unmerged as of this writing);
- access-request emails;
- sharing and notification emails a member can trigger;
- the sign-in code and sign-in link sends: `EMAIL_CODE_EMAIL_RULE` (`apps/api/src/auth/constants.ts:24`) is keyed on the address, so it bounds the target, and the question is what bounds the sender;
- any action that calls a metered third-party service on a member's request.

For each, ask:

- What is the shared resource, and who can spend it?
- For each ceiling: does its key bound the target or the actor? Is there one that bounds the actor?
- Does an N-item action count N against the actor's ceiling?
- Do all of an action's counters go through one sorted pass, before any other row it holds?
- Can two kinds of counter in one table produce the same key?
- Does a counter that belongs to a tenant sit in a table under row-level security?
- Do the words shown when a ceiling is met stay true whichever ceiling it was?
- Can the actor multiply itself, for example across several workspaces? If so, the actor's ceiling may need a wider key still. The code read for this note does not answer that for invitations.

## Examples

**Before: a per-address ceiling only** (earlier on PR #511, before the workspace ceiling was added).

```ts
/** One workspace emails an address at most this often, by an invite or a resend alike. */
const INVITATION_CEILING: CounterRule = { windowMs: 60 * 60_000, max: 5 };

/** In key order, so two actions counting one address queue rather than deadlock; past the ceiling the action fails whole. */
const emailsCounted = async (
  admin: AdminUserPrincipal,
  tx: Tx,
  addresses: readonly string[],
  now: Date,
): Promise<Result<undefined, CeilingMet>> => {
  const keys = addresses.map((address) => counterKeyOf(admin, address)).toSorted(byCodeUnit);
  for (const key of keys) {
    const counted = await consumeIngressIn(tx, "invitation", key, INVITATION_CEILING, now);
    if (!counted.allowed) return err(new CeilingMet(counted.retryAfterSeconds));
  }
  return ok(undefined);
};
```

Every key names an address. A send to 50 new addresses counts 1 against each and meets no ceiling. The next call's 50 new addresses do the same.

**After: the address's ceiling and the workspace's, in one pass** (on PR #511, unmerged as of this writing; `packages/core/src/members/invitation-ceilings.ts:12-51`).

```ts
/** Every workspace mails through one shared account, which a flood could get suspended; a few hundred people still fit in two hours. */
const WORKSPACE_INVITATION_CEILING: CounterRule = { windowMs: 60 * 60_000, max: 200 };

/** No hex digest spells it, so it never meets an address's key, and every one sorts before it. */
const WORKSPACE_KEY = "workspace";

const countersOf = (
  admin: AdminUserPrincipal,
  addresses: readonly string[],
): readonly Counter[] => [
  ...addresses.map((address) => ({
    key: counterKeyOf(admin, address),
    rule: INVITATION_CEILING,
    amount: 1,
  })),
  { key: WORKSPACE_KEY, rule: WORKSPACE_INVITATION_CEILING, amount: addresses.length },
];

/** In key order, the workspace's last, so two actions sharing a counter queue rather than deadlock; past either ceiling the action fails whole. */
export const emailsCounted = async (/* ... */) => {
  const counters = countersOf(admin, addresses).toSorted((one, other) =>
    byCodeUnit(one.key, other.key),
  );
  for (const { key, rule, amount } of counters) {
    const counted = await consumeInvitationEmails(admin, tx, key, rule, now, amount);
    if (!counted.allowed) return err(new CeilingMet(counted.retryAfterSeconds));
  }
  return ok(undefined);
};
```

**The store counts an amount, in the tenant's own rows** (`packages/core/src/store/postgres/index.ts:535-543`). Before, the RLS-exempt counter's upsert added a fixed 1:

```sql
INSERT INTO ingress_counter (scope, key, window_start, count) VALUES ($1, $2, $3, 1)
ON CONFLICT (scope, key, window_start) DO UPDATE SET count = ingress_counter.count + 1
```

After, `consumeInvitationEmails` adds the amount the caller passes (`amount` at `index.ts:531`), into a row its policy holds to the transaction's workspace:

```sql
INSERT INTO invitation_email_counter (workspace_id, key, window_start, count)
VALUES ($1, $2, $3, $4)
ON CONFLICT (workspace_id, key, window_start)
DO UPDATE SET count = invitation_email_counter.count + EXCLUDED.count
```

**The words shown when a ceiling is met** (`apps/web/src/features/people/refusal-words.ts:94-101`). Before, they blamed an address:

```ts
why: "An address here has had too many invitation emails this hour, so nothing was sent.",
```

After, they name both ceilings, because the 429 cannot say which was met:

```ts
/**
 * Invite, Resend and bulk Resend count each address's emails and the workspace's; either ceiling
 * refuses the action whole, and the answer does not say which.
 */
export const invitationsCeiling = (liftsInSeconds: number): Said => ({
  why: "This workspace, or an address here, has had too many invitation emails this hour, so nothing was sent.",
  next: `Try again in ${minutesUntil(liftsInSeconds)}.`,
});
```

## Related

- `docs/solutions/architecture-patterns/adr-0043-what-an-act-is.md`, line 58: a ceiling is no refusal. An action that counts one in its own transaction fails with `CeilingMet`, which rolls the count back, and tRPC answers 429 with `retryAfterSeconds`. This note adds what the ceiling should be keyed on, and why the words must cover every ceiling the action counts. Line 97 records that the in-action ceiling came with KTD11.
- `docs/solutions/architecture-patterns/adr-0040-clock-is-a-kernel-value.md`, line 27: an action that reads one instant and spends it once takes a plain `now: Date`. `emailsCounted` takes `now` from its caller (`invitations.ts:318`, and through `waitingCounted` at `invitations.ts:395` and `invitation-bulk.ts:116`), and the counter's hour is derived from it (`windowStart`, `index.ts:456-457`). So a test can pin the hour a count lands in, as the 201st-email test does.
- `docs/solutions/best-practices/a-race-test-held-late-or-released-in-turn-cannot-prove-a-lock-order.md`: how the test that guards `emailsCounted`'s key order has to hold its racing actions.
- `docs/solutions/best-practices/better-auth-closed-endpoints-run-as-server-functions-without-router-guards.md`: the other rate-limit learning. A route calling a closed Better Auth endpoint must carry its own limiter; that note is about a missing limiter, this one about what a limiter's key bounds.
- `docs/plans/2026-10-01-1807-feat-people-layout-rework-plan.md`: KTD11 (lines 308-320) set the per-address ceiling, and the risk row at line 431 cited it against flooding the shared mail relay. That row is the gap this note describes.
- `docs/plans/2026-10-01-2241-feat-people-sign-in-and-security-plan.md`: the sign-in link and code sends, which spend the same Resend account.
