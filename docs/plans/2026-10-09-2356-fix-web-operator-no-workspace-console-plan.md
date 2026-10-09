---
title: The Operator in No Workspace Lands on the Console - Plan
type: fix
date: 2026-10-09
topic: web-operator-no-workspace-console
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# The Operator in No Workspace Lands on the Console - Plan

## Goal Capsule

- **Objective:** the operator in no workspace reaches the Console from sign-in and from `/`, so better-answers support never has to know to type a console address (BA-36's F28).
- **Means:** the no-workspace page's route sends the operator to the Console's home, Workspaces › Every workspace, before the page draws (KTD1 to KTD3).
- **Authority:** BA-101's acceptance criteria, then `CONCEPTS.md`'s *home (of a role)* and *console* entries, then the units.
- **Stop conditions:** reading the operator's standing before the page draws needs more than the one `session.operator` read in KTD3. Or a workspace member who is also the operator would land anywhere other than their workspace.
- **Execution profile:** one pull request, `Fixes BA-101`, `Merge risk: reversible`. The merge is not armed.
- **Who finishes:** `ce-work` builds it, `ce-code-review` reviews it, and `ce-commit-push-pr` opens the pull request.

---

## Product Contract

### Summary

An operator who belongs to no workspace lands on Console › Every workspace after signing in, after setting up a second factor, and when opening `/`. Every one of those arrivals reaches the no-workspace page today, so the no-workspace page's route asks the operator's standing and sends the operator on.

### Problem Frame

`HOMES.operator` in `apps/web/src/shared/navigation.ts` declares Every workspace as the operator's home, and the glossary says the Console has one home for everyone. But every landing goes through `/`: the shell's route reads the member, the api refuses with `no-active-workspace`, the shell sends the person to `/choose-workspace`, and the picker, finding no workspace held, sends them to `/no-workspace`. That page offers invitations, asking to join, the Account page and sign-out, and nothing that leads to the Console. The operator must know to type `/console/...` (BA-36's F28, screenshot `docs/dogfood-reports/2026-10-09-ba-36-screen-review-assets/f28-operator-no-workspace.png`).

### Requirements

- R1. An operator in no workspace lands on Console › Every workspace after sign-in, after setup and from `/`.
- R2. An operator who is also a member of a workspace still lands in that workspace, and still reaches the Console from the band's workspace switcher.
- R3. A person who is not the operator, in no workspace, still lands on the no-workspace page.
- R4. A browser test covers the operator in no workspace.

### Scope Boundaries

- No change to the shell's route, the index route or the picker. A member who is the operator never reaches `/no-workspace`, so R2 holds by construction.
- No Console link on the no-workspace page. The operator no longer lands there, except with a carried Claude flow (KTD2).
- The Console's switcher keeps its *All workspaces* item. For an operator in no workspace it now leads back to the Console (see Risks).
- No api change. `session.operator` already answers a session with no active workspace.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **The redirect lives in `noWorkspaceRoute.beforeLoad` in `apps/web/src/app/router.tsx`, after `confirmedFirst`.** Sign-in, setup and `/` all reach the no-workspace page through the picker, so the page's route is the one place every path passes. The router is in `src/app/`, which may import `features/console/operator.ts`; the picker is in `features/auth/`, which may not import another feature. A route redirect also means the no-workspace page never draws for the operator, so no flash of the wrong page. Chosen over a check in the picker's effect, which would need the operator's standing lifted into `shared/` and would leave a typed `/no-workspace` unchanged. Governs R1, R3.
- KTD2. **A carried Claude flow keeps the no-workspace page.** When the address bar's query carries a signed flow (`carriedFlow(pageQuery()) !== ""`), the route draws the page as today. The page tells the person Claude connects once they join a workspace, and the Console holds no way to finish that flow, so sending the operator there would drop the signed query. Governs R1's scope.
- KTD3. **The standing is read as the Console's route reads it, and only a `true` answer redirects.** A new exported helper in `apps/web/src/features/console/operator.ts` asks `session.operator` with the options `mustSignInForTheConsole` uses (`retry: false`), afresh (`fetchQuery`) when the route's `beforeLoad` cause is `enter` and from the cache (`ensureQueryData`) otherwise, as the Console's route does. A cached `{ operator: false }` would otherwise outlive a mark granted since it was read, and every arrival at the no-workspace page is an `enter`, so reading afresh costs nothing more. The helper answers whether the reader is the operator. Any failure answers `false`, so the safe failure direction is the page a person in no workspace sees today. The Console's own route asks again on its entry, so the operator's landing reads the standing twice; that is accepted. The redirect replaces the history entry and goes to `HOMES.operator.path`. Governs R1, R3.

### Risks

| Risk | Mitigation |
|---|---|
| A person who is not the operator now pays one `session.operator` request on the no-workspace page | One small read on a page a person sees rarely; it settles before the page draws, so nothing moves under them |
| The operator in no workspace can no longer reach the no-workspace page's invitations and *Ask to join* by typing its address, and the Console switcher's *All workspaces* returns them to the Console | An invitation's email links to `/invitations/<id>` directly, which is unchanged. Recorded in the pull request as a decision the owner may overturn |

### Assumptions

- `session.operator` answers `{ operator: false }` for a signed-in person who is not the operator rather than refusing, as `ConsoleFrame`'s closed state already relies on.

---

## Implementation Units

### U1. The no-workspace route sends the operator to the Console

- **Goal:** the operator in no workspace lands on Every workspace from every landing; anyone else lands where they did.
- **Requirements:** R1, R2, R3, R4; KTD1, KTD2, KTD3.
- **Dependencies:** none.
- **Files:**
  - `apps/web/src/features/console/operator.ts`: a helper answering whether the session is the operator's.
  - `apps/web/src/app/router.tsx`: `noWorkspaceRoute.beforeLoad` asks it after `confirmedFirst` and redirects.
  - `apps/web/e2e/console.spec.ts`: the browser test below, in *the way into the console*.
  - `CONCEPTS.md`: *home (of a role)* says the operator in no workspace lands on the Console's home.
- **Approach:**
  1. Add the helper beside `mustSignInForTheConsole`, sharing `standingOptions` and its afresh-on-enter read.
  2. In `noWorkspaceRoute.beforeLoad`, after `confirmedFirst`, return early on a carried flow, then redirect to `HOMES.operator.path` with `replace` when the helper answers `true`.
  3. Add the browser test, built like `signedInWithNoWorkspace` in `apps/web/e2e/harness.ts` but expecting the Console.
- **Patterns to follow:** `mustSignInForTheConsole` for the read, `consoleIndexRoute` for the redirect, and *sends a signed-out operator to sign in, then back* in `console.spec.ts` for the test's shape.
- **Execution note:** follow the `browser-suite` skill for the spec.
- **Test scenarios:**
  - An operator in no workspace (`person`, then `markTheOperator`) who signs in from `/sign-in` and passes setup lands on `HOMES.operator.path` with the *Workspaces* heading, and the band's switcher names the Console. `signIn` walks the operator's setup, so this covers R1's sign-in and setup.
  - The same operator who then opens `/` lands on `HOMES.operator.path` again.
  - The accessibility gate passes on the Console page reached this way.
  - Existing: *offers the operator the console from the workspace switcher* still passes, covering R2.
  - Existing: `no-workspace.spec.ts` still passes, covering R3.
- **Verification:** the web `check` passes, and root `check:gates` passes.

---

## Verification Contract

| Check | Proves | Applies to |
|---|---|---|
| `pnpm --filter @better-answers/web run check` (typecheck, unit tests, the Playwright suite with the accessibility gate) | R1 to R4 | U1 |
| `pnpm check:gates` | lint, formatting and the repository gates over the edits | U1 |
| `pnpm check:docs` | the plan and glossary words | U1 |

---

## Definition of Done

- The operator in no workspace lands on Every workspace after sign-in, after setup and from `/`.
- A member who is the operator lands in their workspace and reaches the Console from the switcher.
- A person in no workspace who is not the operator lands on the no-workspace page.
- The new browser test passes with the rest of the web suite.
