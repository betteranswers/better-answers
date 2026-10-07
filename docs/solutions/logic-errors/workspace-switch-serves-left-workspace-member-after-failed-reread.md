---
title: "A failed member re-read after a workspace switch left the shell serving the left workspace's member"
date: 2026-10-01
category: logic-errors
module: apps/web
problem_type: logic_error
component: web
severity: high
symptoms:
  - "After a switch whose member re-read failed, the shell kept showing the left workspace's band name, role and page key"
  - "Reads and acts went to the new workspace while the band still named the old one"
  - "With the switch waiting offline (fetchStatus paused), refetchQueries resolved at once and the old member stayed"
  - "After removeQueries alone, the home redirect bounced the person back to the old workspace's home within 8 ms"
  - "After All workspaces picked another, the left workspace's members.list stayed in the cache for up to 5 minutes (gcTime) and was drawn until the new list arrived"
root_cause: wrong_api
resolution_type: code_fix
framework_version: "@tanstack/query-core 5.103.2"
related_components:
  - identity
tags:
  - tanstack-query
  - react-query
  - cache
  - workspace-switch
  - better-auth
  - member
  - reset-queries
  - offline
retire_when: "a released @tanstack/query-core makes refetchQueries report a failed re-read without throwOnError, or makes removeQueries notify mounted useQuery observers; check the query-core release notes and the TanStack Query issue tracker"
---

# A failed member re-read after a workspace switch left the shell serving the left workspace's member

## Problem

The shell showed one workspace and talked to another.

A person switches workspace. Better Auth's `organization.setActive` succeeds, so the session now points at workspace B. The web app then reads the session's member again, in place, so the band does not blank between the two answers. That member holds the band's workspace name, the person's role and the key the page is drawn under. If the re-read failed, or waited offline, the cache kept workspace A's member. The shell went on drawing A's name and A's role while every read and act went to B.

The switch is `useSwitchWorkspace` (`apps/web/src/features/auth/auth-hooks.ts:334-350`). Its re-read is `rereadMember` (`apps/web/src/features/auth/member.ts:53-65`).

The fix is the commit "fix(web): drop the left workspace's answers on every workspace change", on the branch that builds `docs/plans/2026-09-30-1959-feat-shell-and-layout-foundations-plan.md`, unmerged as of this writing. Its message names the code review's findings #3 and #4. This note covers the failed or paused re-read (#4), and the stale member rows the same commit clears when All workspaces picks another workspace (#3).

Library lines below are from `@tanstack/query-core` 5.103.2, installed at `node_modules/.pnpm/@tanstack+query-core@5.103.2/node_modules/@tanstack/query-core/src/`. In this note `queryClient.ts`, `query.ts`, `queryCache.ts`, `queryObserver.ts`, `removable.ts` and `retryer.ts` mean files in that directory. `useBaseQuery.ts` is `node_modules/.pnpm/@tanstack+react-query@5.103.2_react@19.3.0/node_modules/@tanstack/react-query/src/useBaseQuery.ts`. Line numbers hold for those versions only.

## Symptoms

- After a switch whose member read failed, the band still named workspace A. The failed read raised no error to the switch: `rereadMember` returned normally.
- The same happened offline. The pick landed, the network dropped, the band kept A's name while the switch waited.
- The role stayed A's. The frame derives the visible areas and the person's role from the one member it holds (`apps/web/src/app/frame.tsx:171-183`), so A's role was applied over B's data.
- The frame draws the page under `key={here?.workspaceId}` so that a switch redraws it afresh (`apps/web/src/app/frame.tsx:153-155`). With A's member held, that key never changed.
- Navigation followed the stale answer. The index route redirects to the home of whatever role the cache holds (`apps/web/src/app/router.tsx:175-178`), and `roleHeld` reads the cache directly (`member.ts:20-21`).
- A switch through All workspaces drew the left workspace's member rows on the Members page and in jump-to until the new list arrived. `members.list` is asked with no input, so its key names no workspace (`apps/web/src/features/people/people-api.ts:23-26`). The web app sets no `gcTime` (`apps/web/src/shared/api/query-client.ts:13-20`), so the query-core default of five minutes applies (`removable.ts:24-29`).

## What Didn't Work

**Trusting `refetchQueries` to say whether the read worked.** Before the fix, `rereadMember` was one line (the file at the parent of the fix commit):

```ts
/** In place, so a shell reading it moves straight to the new answer. */
export const rereadMember = (queryClient: QueryClient, api: ApiProxy) =>
  queryClient.refetchQueries({ queryKey: memberOptions(api).queryKey, exact: true });
```

Three things in query-core make that silent.

- Failure is swallowed unless `throwOnError` is set. `queryClient.ts:513-515` wraps each fetch in `promise.catch(noop)`, and the doc comment says the same (`queryClient.ts:489-491`).
- A paused query resolves at once. `queryClient.ts:516-518` returns `Promise.resolve()` when `query.state.fetchStatus === 'paused'`. An offline fetch is paused from the start: `fetchState` sets `fetchStatus: canFetch(options.networkMode) ? 'fetching' : 'paused'` (`query.ts:919`), and `canFetch` is `onlineManager.isOnline()` for the default `'online'` network mode (`retryer.ts:57-61`; the web app sets no `networkMode`), and `fetch()` dispatches the `'fetch'` action, which applies it (`query.ts:843-848`), before its first `await` (the dispatch is at `query.ts:717-723`; `fetch()` starts at `:590` and its first `await` is at `:756`). So the check at `queryClient.ts:516` sees `'paused'`.
- A failed fetch keeps the old data. The `'error'` case of the reducer spreads `...state` and sets the error fields, `fetchStatus: 'idle'`, `status: 'error'` and `isInvalidated: true` (`query.ts:865-879`). It never touches `data`.

So after a failed or paused re-read the cache held A's member, and `refetchQueries` had resolved as if all was well.

**Calling `removeQueries` after seeing `status === 'error'`.** This was the session's first fix, and it was never committed. It dropped the cached answer and still failed. Per this session's trace, `WorkspaceFrame` kept A's role, and the home redirect bounced the person back to A's home within 8 ms. The 8 ms figure is the session's measurement, not something this note re-measured. The mechanism is in the source:

- `removeQueries` calls `queryCache.remove` for each match (`queryClient.ts:378-387`). `remove` destroys the query, deletes it from the map and emits a `'removed'` event to cache subscribers (`queryCache.ts:208-216`). `Query.destroy` calls the base class's `destroy`, which clears the gc timeout (`removable.ts:10-12`), and then silently cancels any fetch (`query.ts:361-365`).
- A mounted observer is told of changes in one place: `Query.#dispatch` calls `observer.onQueryUpdate()` on each observer (`query.ts:822`, `:899`). Nothing in `removeQueries` dispatches. The one cache subscription in `queryObserver.ts` is in the suspense path (`queryObserver.ts:418`), not the path a normal `useQuery` takes.
- The observer moves to a replacement query only when it next runs `setOptions` (`queryObserver.ts:208`, called after a render from `useBaseQuery.ts:117-119`) or starts a fetch (`queryObserver.ts:464`).
- `WorkspaceFrame` calls `useMember`, `useOperatorStanding` and `useMemo`, and nothing from the router (`frame.tsx:168-188`). The router state is read one level down, in `Frame` (`frame.tsx:72`), which re-renders `Frame` and not its parent. So nothing re-rendered `WorkspaceFrame`, its observer went on holding the removed query with A's data, and `held` stayed A's.
- Meanwhile the cache was empty. The index route's `beforeLoad` found no role and let `HomeUnread` render (`router.tsx:175-182`). That component takes `home` from `useVisibleTree()`, which the stale frame still supplied, and navigated to it.

The removal was right for the cache and wrong for the page.

**Setting `throwOnError: true` (reasoned, not tried).** It would raise a failed read. It would not touch the paused case, because `queryClient.ts:516-518` returns before the fetch promise is consulted. It also leaves A's data in place when the read does fail, so a catch would still have to drop it.

## Solution

### 1. Re-read in place, then reset anything that is not a fresh answer

`apps/web/src/features/auth/member.ts:53-65`, after the fix:

```ts
/**
 * In place, so the shell moves straight to the new answer. A failed or paused read keeps the left
 * workspace's answer, which is dropped.
 */
export const rereadMember = async (queryClient: QueryClient, api: ApiProxy) => {
  const filters = { queryKey: memberOptions(api).queryKey, exact: true };
  await queryClient.refetchQueries(filters);
  const read = queryClient.getQueryState(filters.queryKey);
  // Reset, not removed: the frame's mounted read never hears a removal and goes on drawing it.
  if (read?.status !== "success" || read.fetchStatus !== "idle") {
    void queryClient.resetQueries(filters);
  }
};
```

The condition keeps the answer only when the query is `success` and `idle`. A read that landed keeps the in-place behaviour, so the band never blanks on the happy path. An errored read (data kept, `status: 'error'`) and a paused read (data kept, `fetchStatus: 'paused'`) are both reset. The reset is not awaited.

### 2. One shared step that clears the left workspace's other reads

`apps/web/src/features/auth/auth-hooks.ts:274-289`, after the fix:

```ts
const aboutTheWorkspace = (api: ApiProxy) => {
  const theirOwn = [
    { queryKey: AUTH_KEYS.all },
    api.session.pathFilter(),
    api.console.pathFilter(),
  ];
  return (query: Query) => !theirOwn.some((filters) => matchQuery(filters, query));
};

/**
 * Some reads, such as the members, name no workspace in their key, so a held answer is the left
 * workspace's.
 */
const forgetTheWorkspaceLeft = (queryClient: QueryClient, api: ApiProxy) => {
  queryClient.removeQueries({ predicate: aboutTheWorkspace(api) });
};
```

Before the fix, `aboutTheWorkspace` sat below `useSetActiveOrganization`, and only the switch used it, inline: `queryClient.removeQueries({ predicate: aboutTheWorkspace(api) })`. The picker's `onSuccess` called `forgetMember` and invalidated the session and workspace list, and nothing else. Now it reads:

```ts
onSuccess: () => {
  forgetMember(queryClient, api);
  forgetTheWorkspaceLeft(queryClient, api);
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: AUTH_KEYS.session }),
    queryClient.invalidateQueries({ queryKey: AUTH_KEYS.workspaces }),
  ]);
},
```

(`auth-hooks.ts:295-309`.) `useSwitchWorkspace` calls `forgetTheWorkspaceLeft` and then `await rereadMember` (`auth-hooks.ts:343-348`). `useAcceptInvitation` gained the same call (`auth-hooks.ts:211-226`) in the next commit on the branch, "fix(web): hide a page once a role read late shows it is not theirs". The three callers are `auth-hooks.ts:219`, `:302` and `:344`.

`forgetMember` (`member.ts:48-51`) stays a `removeQueries`. The picker is a sibling of the shell route, not a child (`router.tsx:141`), so no mounted observer holds the member there and a removal is enough. That is the reading the code supports. Where the accept-invitation route sits in the tree was not traced here.

## Why This Works

`resetQueries` notifies. It calls `query.reset()` on every match (`queryClient.ts:409`). `Query.reset` destroys the query, which cancels any fetch, and then sets the state back to its initial state (`query.ts:377-380`). `setState` goes through `#dispatch` (`query.ts:334-336`), and `#dispatch` calls `observer.onQueryUpdate()` on each attached observer (`query.ts:899`). The query stays in the cache and the observer stays attached to it, so the mounted `useQuery` in `WorkspaceFrame` hears the change without any re-render of its parent.

`held` becomes `undefined`, so `here` and `person` become `undefined` (`frame.tsx:171-183`), and the band empties. The member query sets no `initialData` (`member.ts:5-7`), so "initial state" holds no data.

Then the reset refetches. After the matches are reset, `resetQueries` refetches the ones that are active (`queryClient.ts:413`), and the shell's mounted observer makes this one active. If the read fails again, the shell shows its failed page and a retry (`RoleUnread`, `router.tsx:159-170`), which is what the first spec asserts (`workspace-switcher.spec.ts:410-416`). If the device is offline, the offline spec goes back online and lands on the new workspace's home and name (`:444-446`).

Checking `fetchStatus` as well as `status` is what catches the paused case. A paused read after a good pick has `status: 'success'` (A's data) and `fetchStatus: 'paused'`, so a check on `status` alone would keep A's answer.

The reset is not awaited. Its promise settles with the refetch it starts (the doc comment at `queryClient.ts:391-392`), and the switch need not wait on that to invalidate the session and navigate. Navigating to `/` then reads afresh. The shell route's `memberRefusal` calls `ensureQueryData` (`member.ts:41`), which returns cached data when there is any and fetches only when there is none (`queryClient.ts:197-223`). Before the fix it found A's data. Now it finds nothing and reads. The index route's `roleHeld` finds no stale role to redirect on.

`forgetTheWorkspaceLeft` is also a `removeQueries`, and the same limit applies to it. It clears reads such as `members.list`, whose key names no workspace. A removal reaches no observer that is already mounted on the removed query. What keeps the old rows off the page here is that the frame redraws the page under the workspace's id (`frame.tsx:153-155`), so a new observer builds a fresh query after the removal. The member now moves on every switch, including the failed one, so that key now changes. Whether some other mounted reader of a removed query could outlive a switch was not traced here. The spec at `:180` checks the picker path and the Members page and jump-to, not every reader.

## Prevention

- **Choose the verb by who is watching.** `removeQueries` is for a query with no mounted observer. For a query a mounted `useQuery` is drawing, use `resetQueries`, or `invalidateQueries` when stale data may stay in view. A removal that must reach a mounted observer needs a re-render that the code does not control.
- **Never take `await refetchQueries(...)` as proof of a fresh answer.** It resolves on error and on pause. Read `getQueryState` afterwards and check both `status` and `fetchStatus`. `throwOnError: true` closes only the error half.
- **Treat data on an errored query as stale.** `status: 'error'` with `data` present is a normal state (`query.ts:865-879`). Anything scoped to a workspace must not be read through it.
- **Put the scope in the key where the key can carry it.** `members.list` has no workspace in its key, which is why `forgetTheWorkspaceLeft` exists. Moving the id into the key would make that clearing unnecessary. This commit does not do that, and how the web app's tRPC keys are built was not checked here.
- **Send every new way of changing workspace through `forgetTheWorkspaceLeft`.** A new read that belongs to no workspace, as the console's do, must be added to `theirOwn` in `aboutTheWorkspace` (`auth-hooks.ts:274-281`) or it will be dropped on every switch.
- **Test shape: a real browser with a mounted observer, asserting on what is drawn.** A unit test that asserts `getQueryData(key) === undefined` passes against the failed `removeQueries` fix, because `getQueryData` reads straight from the cache (`queryClient.ts:183-191`). The bug lived between the cache and the page. The three specs in `apps/web/e2e/workspace-switcher.spec.ts` have this shape:
  - Two workspaces, the person a member of both, signed in to the first (`inTwoWorkspaces`, `:64-81`), each with a name or member unique to it so a leftover is visible.
  - Force the failure. Abort the member read with `page.route(MEMBER_READ, (route) => route.abort())` (`:401`). Or let the pick land, then go offline with `route.fetch()`, `context.setOffline(true)` and `route.fulfill(...)` (`:431-435`), which is the paused path.
  - Assert the old name is gone: `switcherOf(page, first.name)` has `toHaveCount(0)` (`:406-409`, `:440-442`). Allow 15 s for the failing case, because the switch's read and then the shell's each ask twice more before they give up (`:405`, `query-client.ts:5`, `:17`).
  - Assert the way back: remove the abort or go online, then `landedAtHome` and the new workspace's name is on the switcher (`:415-418`, `:444-446`).
  - For stale rows, hold the new workspace's read with `heldBack` (`:84-94`), so the gap state is showing, and assert the old rows have a count of 0 on the page and in jump-to (`:193-211`). The spec is "drops the left workspace's members when All workspaces picks another" (`:180`). The other two are "drops the left workspace's name when the member read fails" (`:393`) and "drops the left workspace's name while the switch waits offline" (`:421`).
- **The join path has no spec among these three.** `useAcceptInvitation` calls the shared step, but whether `accept-invitation.spec.ts` asserts the drop was not checked here. Check before relying on it.
- **Re-run the three specs on every `@tanstack/query-core` bump.** They are the tripwire for the behaviours this note relies on in 5.103.2: `refetchQueries` swallowing errors and resolving on pause, the error reducer keeping data, and `removeQueries` not notifying a mounted observer.

## Related Issues

- `docs/solutions/architecture-patterns/adr-0047-the-platform-is-surfaces-groups-and-screens.md` reads the member this note keeps fresh. Its "Who sees what" rules decide a page's visibility from the person's role, so a stale member makes that verdict come from the workspace the person left.
- `docs/solutions/architecture-patterns/adr-0009-better-auth-in-process-identity-provider.md` keeps Better Auth's `/organization/set-active` for the picker, and the switch calls the same endpoint. The ADR says nothing about the query cache. This note's reading is that a successful set-active tells the tRPC query cache nothing, which is why the web app clears workspace-scoped reads itself.
