---
title: "A second press on a pending act dropped the first act's answer"
date: 2026-10-02
category: logic-errors
module: apps/web
problem_type: logic_error
component: web
severity: medium
symptoms:
  - "Removing yourself from your own member page, pressed twice while the first request was in flight, left you on the page with a not-a-member refusal instead of landing on the workspace chooser"
  - "A second bulk act of the same kind, sent from the selection bar before the first answered, lost the first act's refusal marks, its outcome line and, when the first set included the reader, its landing"
  - "Only the mutation-level onSettled (the list's reconciliation) still ran for the first act; every per-call onSuccess and onError passed to mutate() for it was silently skipped"
root_cause: wrong_api
resolution_type: code_fix
framework_version: "@tanstack/query-core 5.103.2"
tags:
  - tanstack-query
  - react-query
  - use-mutation
  - mutate-callbacks
  - double-submit
  - bulk-act
  - self-act
retire_when: "a released @tanstack/query-core keeps an earlier mutation's per-call mutate() options when the same observer mutates again; check MutationObserver.mutate in the query-core release notes and source"
---

# A second press on a pending act dropped the first act's answer

## Problem

An act whose answer is handled in callbacks passed to `mutate()` lost that answer when the same act was sent again before the first one returned. The reader then saw the second answer only, or nothing, and in the self-act cases was left on a page they could no longer use.

Code review findings #1 and #2 on PR #507 (the People layout rework's Members stream, `docs/plans/2026-10-01-1807-feat-people-layout-rework-plan.md`, U7 and U8) found two instances of the same cause. Library lines below are from `@tanstack/query-core` 5.103.2 (`node_modules/.pnpm/@tanstack+query-core@5.103.2/node_modules/@tanstack/query-core/src/mutationObserver.ts`), and hold for that version only.

## Symptoms

- Own removal: the confirm button on the member page stayed pressable while the request was pending. A second press sent a second request; the first succeeded, the second was refused because the person was already removed, and the page showed that refusal. The landing on `/choose-workspace` that the first call's `onSuccess` would have run never ran.
- Bulk acts: each bulk dialog holds one `useMutation` for the life of the Members list, and `command()` closes the dialog and clears the ticks at once, so the reader could tick others and send the same kind of act again while the first was pending. The first act's refusal marks, its done line and its self-act landing were lost.

## What Didn't Work

Nothing was attempted before the fix; the defect came from reading `useMutation` as if each `mutate()` call kept its own callbacks for the life of its request. It does not.

## Solution

`MutationObserver.mutate` replaces the observer's per-call options and detaches the observer from the mutation it was watching before it builds the next one:

```ts
mutate(variables, options) {
  this.#mutateOptions = options

  this.#currentMutation?.removeObserver(this)

  this.#currentMutation = this.#client
    .getMutationCache()
    .build(this.#client, this.options)
```

The earlier request still runs to completion, and options given to `useMutation` itself (such as the list's reconciling `onSettled`) still fire, because they belong to the mutation, not to the call. Only the callbacks passed to the earlier `mutate()` call are gone.

So an act whose per-call callbacks carry its answer must not let a second call reach the same observer while the first is pending. Both fixes refuse the second press:

- `apps/web/src/features/people/member-page.tsx`, `useRemoval`'s `remove()`: `if (removeMember.isPending) return;`, the same guard `CredentialsRevoker` already used in `member-sections.tsx`, with the confirm button marked `aria-disabled` while pending so focus stays on it.
- `apps/web/src/features/people/member-bulk-acts.tsx`, `useMemberBulkActs`: an `acting` flag set when an act is sent and cleared first thing when it succeeds or fails. While it is set, the bar's acts and their keystrokes refuse to open another act and say "The act before this one is still going. Try again once it answers.", and `command()` sends nothing. It blocks every kind of act, not only the same kind, so two acts' outcome lines cannot overwrite each other.

The browser specs in `apps/web/e2e/people.spec.ts` hold the first request's answer back and press again; both failed on the unguarded code.

## Why This Works

The callbacks are lost only when a second `mutate()` reaches the same observer before the first request settles. Refusing that second call while the first is pending means the observer never detaches from a request whose answer the page still needs.

## Prevention

- When a page keeps one `useMutation` mounted and handles the answer in callbacks passed to `mutate()`, guard every way of calling it (button, keystroke, dialog commit) with the mutation's pending state, or hold an explicit "acting" flag, before calling `mutate()` again.
- Put behaviour that must run for every request (cache reconciliation, re-reads) in the options given to `useMutation`, where a later call cannot drop it.
- Mark the control `aria-disabled` rather than `disabled` while pending, so keyboard focus is not thrown back to the page.
- A spec for any act that lands somewhere or marks rows should press twice with the first answer held back.

## Related Issues

- `docs/solutions/logic-errors/workspace-switch-serves-left-workspace-membership-after-failed-reread.md`: another TanStack Query behaviour (a failed `refetchQueries` resolving quietly) that this web client relies on knowing.
- The Invitations stream (U11, U12) builds bulk Resend and Cancel on the same selection-bar shape, and inherits this guard.
