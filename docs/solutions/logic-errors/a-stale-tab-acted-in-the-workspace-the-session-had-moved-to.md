---
title: "A browser tab left behind by a workspace switch acted in the workspace the session had moved to"
date: 2026-10-12
category: logic-errors
module: apps/web
problem_type: logic_error
component: web
severity: high
applies_when:
  - "Changing the workspace switch, the session's active workspace, or what a tab caches for it"
  - "Writing an action or read whose workspace comes from the session rather than from the request"
  - "Adding an optimistic update that rolls back into the query cache after a refusal"
symptoms:
  - "A person in two workspaces switched workspace in one browser tab, then removed a member from another tab still showing the old workspace, and the member was removed from the new one"
  - "A stale tab that stayed visible and opened another People page drew the new workspace's invitations under a band that still named the old workspace"
  - "A hidden tab shown again redrew its page under the new workspace with the old workspace's rows still on it, until each list answered"
  - "After a refused action dropped a workspace's reads, the action's own rollback put that workspace's rows back in the cache"
root_cause: missing_validation
resolution_type: code_fix
framework_version: "@tanstack/query-core 5.104.1"
related_components:
  - identity
  - api
tags:
  - tanstack-query
  - cache
  - workspace-switch
  - session
  - trpc
  - optimistic-update
  - playwright
  - member
---

# A browser tab left behind by a workspace switch acted in the workspace the session had moved to

## Problem

One browser holds one session, and the api took the workspace from the session. A person who is a member of workspaces A and B switched to B in one browser tab. Their other tab still showed A. An action from that tab ran in B, on the same person id, because a person's id is the same in every workspace.

The fix landed in #705 (BA-81 and BA-50); #731 (BA-149) later extended the road check to reads. This note records what the fix had to learn, which the final code does not show.

## Symptoms

- The stale tab's removal, role change or bulk action landed in the workspace the session had moved to.
- With both windows visible, the stale tab never re-read anything, so the old page stood indefinitely.
- When the person opened another page in the stale tab, that page's lists were read from B while the band still named A.
- When a hidden tab was shown again, its member read answered B first. The frame redrew the page under B with A's cached rows on it.

## What Didn't Work

**A list of the actions that need the check.** The first scope bound ten actions: those on a member page or a ticked set, inviting, and creating a group. Actions keyed by an invitation id, a request id or a group id were left out, because each id exists in one workspace only and a stale action "is refused as absent". That holds only while the ids on screen are the old workspace's. A page that mounts reads again (`staleTime` is 0), so a stale tab that opens Invitations draws B's invitations under A's band, and cancelling one succeeds in B. Any list of exempt actions fails the same way.

**The workspace as a field on each action's input.** It would have changed twenty input schemas, their hooks and most of the api's tests, and still covered People alone. Writes outside People (an upload, a source's review) had the same gap.

**Reading the tab's workspace "at the press" and trusting it.** The member read and each list refetch separately when a tab becomes visible. The member read can name B while A's rows are still drawn. A value read from the member read at that moment names B beside a row from A.

**Dropping the left workspace's reads in a React effect.** `Frame` keys the page by the member's workspace. When the member read answers B, the page remounts and draws from the cache before any effect runs.

**An unconditional rollback.** Each optimistic hook kept the list as it was and wrote it back on a refusal. Writing to a key that was dropped in between makes the read again, holding the left workspace's rows.

## Solution

**The check belongs to the road, not to an action.** The web's one tRPC link sends the workspace of the tab's held member read in the `x-tab-workspace` header on every request (`apiLink` in `apps/web/src/shared/api/link.ts`). The api's two workspace roads compare it with the session's workspace straight after the session's claims are read (`claimsInTheTabsWorkspace` in `apps/api/src/trpc/base.ts`). A mutation naming another workspace, or none, is refused as `workspace-switched`, a transport word of class *conflict*. Since #731 a query naming another workspace is refused the same way; a query naming none is answered, and `session.member` is never refused, because it is how a tab learns where the session is. The comparison comes before any ceiling, before the principal and before the input is parsed, so a stale tab hears this word and no other. A test walks the api's router and holds every mutation and every query on a workspace road to it (`apps/api/tests/trpc-roads.test.ts`).

**A refused tab does what a switch does.** The one listener that hears every failed action goes by the word alone and runs the switch's own tail, `followTheSession` in `apps/web/src/features/auth/auth-hooks.ts`: drop the left workspace's reads, read the member again with a reset on failure, land home. It does not test the address, because a refusal that arrives after the person left the page still means the tab is stale.

**The drop runs in the same cache event as the member answer.** `forgetAWorkspaceLeftElsewhere` subscribes to the query cache and drops the left workspace's reads when the member read's workspace changes. A cache subscriber runs before observers render, so the remounted page finds no rows to draw.

**A rollback restores only into the read it took from.** `takenFrom` in `apps/web/src/shared/api/optimistic.ts` remembers the query object, not only its data, and undoes nothing when the key no longer names that object. Four rollbacks use it: the member list, the invitation lists, the requests list and the shared `useOptimistic`.

## Why This Works

A header on the link and a comparison on the road are one statement on each side: every action in a workspace names the workspace its tab holds. There is no list to keep, and a new procedure on a workspace road is checked without being named.

Two orderings in `@tanstack/query-core` 5.104.1 carry the web's half. Both were confirmed by test, not by reading the docs:

- A query-cache subscriber is called before the observers of that query notify React, so a drop made there is in place before a remounted page reads the cache.
- The mutation cache's `onError` runs before a hook's own `onError`. The listener's drop therefore lands before the hook's rollback, which is why the rollback must check the read it took from.

A tab loaded before the release sends no header. The api refuses its actions, and the old bundle says the unknown word by its class: reload the page and try again. That is the right instruction for it.

## Prevention

- **Bind a request to what the tab shows through the transport, never through a list of actions.** If a new road changes anything in a workspace, it takes the comparison from the road it is built on.
- **Treat every way a tab can learn its workspace changed as a workspace change.** A refusal and the tab's own member read are both ways. Each drops the left workspace's reads before anything draws.
- **A two-tab Playwright spec proves the two-visible-windows case only.** TanStack Query's focus manager listens to `visibilitychange`, and Playwright fires none when a test moves between pages of one context (`context.newPage()`). The case where a hidden tab is shown again needs a test rendered through the web's own router, with the list read held back while the member read answers the other workspace (`apps/web/test/returning-tab.test.tsx`).
- **Seed the proof so the unfixed code would succeed.** The acting person is an Admin of both workspaces and the person acted on is a member of both, with a different role in each so a row tells which workspace it was read from. Otherwise `role-forbids` or `no-such-member` refuses first and "nothing changed" proves nothing.
- **Make a test's stub answer a turn of the event loop later.** With an answer in the same turn, the switch's landing commits before the frame hears the reset, and the test fails on unchanged code. A browser request never answers in the same turn.
- **An optimistic rollback checks that its read still exists.** Any step that drops reads can run between an action's start and its refusal.

## Related Issues

- `docs/solutions/logic-errors/workspace-switch-serves-left-workspace-member-after-failed-reread.md` covers the switch made in the same tab: which cache verb reaches a mounted observer, and why an awaited refetch is no proof of a fresh answer. Its file addresses predate this work. The member read and its re-read now live in `apps/web/src/shared/member.ts`, and `memberChanged` replaces `rereadMember`.
- `docs/solutions/logic-errors/a-second-mutate-drops-the-first-actions-callbacks.md` is why the refused tab's step is wired at the listener and in each mutation's own options, never in a per-call callback.
- `docs/solutions/architecture-patterns/adr-0043-what-an-act-is.md` records the transport word and the roads' comparison.
- On BA-149: the header is read when the request is sent, not when the person pressed, which leaves a gap of milliseconds. The consent page, a Hono route this check does not reach, now carries the workspace it was drawn for and refuses a grant naming another (#731). A refusal that lands while a follow is under way joins it (`followedOnce` in `apps/web/src/features/auth/switched-elsewhere.ts`).
