---
title: "A read held for good in a spec stalled the action's settle, and its refusal line never came"
date: 2026-10-15
category: logic-errors
module: apps/web
problem_type: test_failure
component: web
severity: medium
applies_when:
  - "Holding a request with `page.route` in a Playwright spec that also checks an optimistic action's refusal"
  - "Seeing a mutation's mutation-level `onError` run while its per-call `mutate()` `onError` never does"
  - "Debugging `people-requests.spec.ts` or a spec that passes locally and fails in the merge queue"
symptoms:
  - "A Playwright scenario that refused an optimistic decline failed with \"the alert says nothing\": the row came back, but no refusal line was drawn"
  - "The mutation-level onError ran (the undo restored the row) while the per-call mutate(vars, { onError }) callback that writes the page's line never ran, so the symptom read as a product bug"
  - "The same scenario passed locally when its held read answered, and failed twice in the merge queue once it held the read for good"
root_cause: async_timing
resolution_type: test_fix
framework_version: "@tanstack/query-core 5.104.1"
tags:
  - playwright
  - page-route
  - tanstack-query
  - use-mutation
  - mutate-callbacks
  - optimistic-update
  - held-request
retire_when: "a released @tanstack/query-core dispatches a mutation's error state to its observers before awaiting the options-level onSettled; check Mutation.execute in the query-core source"
---

# A read held for good in a spec stalled the action's settle, and its refusal line never came

## Problem

A browser scenario wanted to prove that an optimistic removal is undone by the action's own rollback, not by the read that follows a refusal. It held the list's read with a `page.route` that never answered. The row came back as expected, but the refusal line the page writes from the action's per-call `onError` never appeared, and the scenario failed twice in the merge queue on PR #760 with "the alert says nothing". Library lines below are from the installed package `@tanstack/query-core` 5.104.1, its Mutation class (a dependency, not a tracked file), and hold for that version only.

## Symptoms

- `apps/web/e2e/people/people-requests.spec.ts`, "brings a request back when the api refuses its decline": `saysARefusal(requestsRegion(page).getByRole("alert"))` timed out with no alert in the region, while `rowOf(page, "Priya Shah")` was back.
- A probe with console markers showed the mutation-level `onError` from `useLeavesAtOnce` running and the per-call `onError` in `requests-tab.tsx` never running, with no unmount of the list in between.

## What Didn't Work

- Swapping the refusal word (a `role-forbids` refusal for an `already-decided` one) changed nothing: the word was never the cause.
- Reading the page for a detour on a forbidden refusal: `detourAfter` leaves a refusal that is not a pending one alone, so nothing navigated away.

## Solution

`Mutation.execute` runs the mutation-level callbacks and awaits each before it dispatches the error state to its observers:

```js
} catch (error) {
  await this.#mutationCache.config.onError?.(error, ...);
  await this.options.onError?.(error, variables, this.state.context, ...);
  await this.#mutationCache.config.onSettled?.(void 0, error, ...);
  await this.options.onSettled?.(void 0, error, variables, this.state.context, ...);
  this.#dispatch({ type: "error", ...
```

The observer's `#notify` fires the per-call `mutate()` callbacks only on that dispatch. `useDeclineRequest` gives the mutation `onSettled: () => reconcile()`, and `reconcile` is `queryClient.invalidateQueries({ queryKey })`, a promise that resolves only when the refetch it starts has answered. A route that never answers that read holds the settle for good, so the error state is never dispatched and the page's per-call `onError` never runs. The undo had already run from the options-level `onError`, which is why the row came back.

The fix is in the spec. The held read is releasable, the optimistic effect is asserted before it is released, and the settle's effect after:

```ts
const answerTheRead = await holdingTheRequestsRead(page);
const refuse = await refusingTheDeclineOnRelease(page);
// press Decline; the row leaves before the api answers
refuse();
await expect(rowOf(page, "Priya Shah"), "the refused decline left the row gone").toHaveCount(1);
answerTheRead();
await saysARefusal(requestsRegion(page).getByRole("alert"));
```

Both holders are one helper, `heldUntilReleased(page, procedure, answer)`, which routes the procedure and awaits a release before it answers.

## Why This Works

Asserting the row's return before the read is released proves the undo alone restored it, because the only other path that could, the refetch, has not answered yet. Releasing the read then lets `invalidateQueries` resolve, the settle finish, the error state reach the observer, and the per-call `onError` write the line. The product was never wrong: a read that answers eventually, as every real one does, settles the action.

## Prevention

- In a spec, never hold a read for good when an action's `onSettled` invalidates it. Hold it until a returned call, assert the optimistic effect, release, then assert what the settle produces.
- When a per-call `mutate()` callback seems not to run while the mutation-level one did, check first whether the mutation has settled; the per-call callbacks wait on the mutation's own `onSettled`.

## Related Issues

- `docs/solutions/logic-errors/a-second-mutate-drops-the-first-actions-callbacks.md`: the other way a per-call `mutate()` callback goes missing, a second call on the same observer.
- `docs/solutions/logic-errors/a-stale-tab-acted-in-the-workspace-the-session-had-moved-to.md`: the optimistic undo's `takenFrom` rule the scenario proves.
