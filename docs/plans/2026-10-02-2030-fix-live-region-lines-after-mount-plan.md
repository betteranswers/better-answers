---
title: Live Region Lines After Mount - Plan
type: fix
date: 2026-10-02
topic: live-region-lines-after-mount
artifact_contract: ce-unified-plan/v1
product_contract_source: linear
execution: code
---

# Live Region Lines After Mount - Plan

## Goal Capsule

- **Objective:** a screen reader announces every listed screen's loading and failure lines, because each line fills its live region a render after the region mounts.
- **Means:** one shared hook gives a read's `error` and `isPending` a render late. Every live region that says a read's state takes its words from it, and `ListRead` and `GroupsReadSaid` adopt it, so the tree holds one pattern.
- **Product authority:** the owner, through Linear BA-31. On 02/10/2026 the owner chose to fix all of BA-31's screens now, the three People screens included, rather than leave them to the People plan's U13, and added `routes-card.tsx` to BA-31.
- **Open blockers:** none.
- **Stop conditions:** a screen whose region cannot mount empty without changing what it shows sighted readers: stop and report it.
- **Execution profile:** `ce-work` builds it in one pull request that says `Fixes BA-31`.

---

## Product Contract

### Problem Frame

A live region that is inserted with its words already inside may never be read: assistive technology announces changes to a region it already tracks, not the region's first contents. Several older screens draw "still loading" or a read's refusal into an `aria-live` region on the render that mounts it. Cubic found the pattern on PR #507. That PR fixed the screens it touched with `useDeferredValue(value, initialValue)` (`apps/web/src/features/people/groups-read.tsx`), #511 did the same in the shared `ListRead` (`apps/web/src/shared/list-pages.tsx`), and BA-31 lists the rest.

### Requirements

- R1. Each region below mounts empty and holds its loading or failure line one render later:
  - `apps/web/src/features/people/group-sheet.tsx` (`GroupMembers`)
  - `apps/web/src/features/people/groups-screen.tsx` (`GroupsSection`)
  - `apps/web/src/features/people/requests-tab.tsx` (the read's refusal in its `OutcomeLine`, and the loading line)
  - `apps/web/src/features/sources/bindings-screen.tsx` (`ListStatus`)
  - `apps/web/src/features/sources/review.tsx` (the findings region in `Review`, and the chunks region in `Preview`)
  - `apps/web/src/features/console/workspaces-screen.tsx` (`ListState`)
  - `apps/web/src/features/routes/routes-card.tsx` (`RoutesCard`)
- R2. No loading or failure line lingers a render after the read settles.
- R3. No state is set in an effect to do it. `react/set-state-in-effect` already refuses that outside `apps/web/src/shared/ui/**`.
- R4. One unit test per region shape pins that the region starts empty and then holds the line.

### Scope Boundaries

- The empty lines that share a region (`data.length === 0` in `bindings-screen.tsx`, `review.tsx` and `routes-card.tsx`) stay as they are. They are not loading or failure lines, and they appear only once data has arrived after the region mounted, unless the data was cached.
- `apps/web/src/features/people/members-tab.tsx` holds no live region of its own, so it is not touched.
- The act outcomes an `OutcomeLine` says (`requests-tab.tsx`'s `outcome`) follow an act, after the region mounted, so they stay live as they are.

---

## Planning Contract

### Key Technical Decisions

- **KTD1. One hook in `apps/web/src/shared/`.** It returns `{ error, isPending }` deferred with `useDeferredValue(…, null)` and `useDeferredValue(…, false)`, each gated by the live value: `isPending` is `read.isPending && deferred`, and `error` is `read.error` only while both are non-null. The deferred value lags a render on the way back too, so an ungated line would linger after the rows arrive (R2).
- **KTD2. Branch on the live read, fill words from the hook.** This is what `ListRead` already does. A caller that falls through to `data` must not take a deferred `isPending: false` on the first render as "data is here": `workspaces-screen.tsx`'s `ListState` would read `listed.data.length` of `undefined`.
- **KTD3. `Preview`'s region moves into a child that mounts with it.** Its region mounts inside `CollapsibleContent` when the reader opens it, long after `Preview` mounted, so a hook in `Preview` has already spent its initial value. A child rendered inside `CollapsibleContent` calls the hook, and its initial value meets the region's mount.
- **KTD4. One probe records every commit.** The layout-effect probe in `apps/web/test/list-read.test.tsx` sees only the commits its own parent renders, and a deferred re-render or a click inside the screen re-renders only the screen. A `Profiler`'s `onRender` runs on every commit in its tree, so a shared helper built on it sees the region's text at each one, the first included.

## Implementation Units

### U1. The hook, the shared probe, and the two existing sites

**Files:**
- `apps/web/src/shared/read-said.ts` (new: the hook)
- `apps/web/src/shared/list-pages.tsx` (`ListRead` adopts it)
- `apps/web/src/features/people/groups-read.tsx` (`GroupsReadSaid` adopts it)
- `apps/web/test/regions-seen.tsx` (new: the `Profiler` probe)
- `apps/web/test/list-read.test.tsx` (takes the shared probe)
- `apps/web/test/read-said.test.tsx` (new)

**Test scenarios:** a pending read's region mounts empty and then says the loading line; a failed read's region mounts empty and then says the failure; once the read settles, the next commit holds no loading line.

### U2. The eight regions

**Files:** the seven files in R1.

**Approach:** each region takes its words from the hook (KTD1, KTD2). `routes-card.tsx` reads `routes.error` rather than `routes.isError`. `review.tsx`'s chunks region becomes a child of `CollapsibleContent` (KTD3).

**Test scenarios**, in `apps/web/test/said-after-mount.test.tsx` (new), each rendered inside `Providers` with a `fetch` that never answers:
- the `OutcomeLine` and loading region shape: `GroupsScreen`'s loading region mounts empty and then says the line;
- the one region of lines: `RoutesCard`'s region mounts empty and then says the line;
- the early-return state: `WorkspacesScreen`'s region mounts empty and then says the line;
- the region inside a disclosure: opening `Review`'s preview mounts the chunks region empty, and it then says the line.

## Verification Contract

- `npx vitest run test/read-said.test.tsx test/list-read.test.tsx test/said-after-mount.test.tsx` from `apps/web`.
- `pnpm check:web`, and the root `check:gates` lint.

## Definition of Done

- Every region in R1 mounts empty and then holds its line, pinned by U1's and U2's tests.
- The pull request says `Fixes BA-31`, and BA-31 has a progress comment naming it.
