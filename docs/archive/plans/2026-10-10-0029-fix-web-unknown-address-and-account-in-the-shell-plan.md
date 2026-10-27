---
title: An Unknown Address and the Account Page Inside the Shell - Plan
type: fix
date: 2026-10-10
topic: web-unknown-address-and-account-in-the-shell
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# An Unknown Address and the Account Page Inside the Shell - Plan

## Goal Capsule

- **Objective:** a person who reaches an address with no page, or opens their Account page, stays inside the product's frame and can move on without the browser's back button (BA-36's F6, F7, F8).
- **Means:** the root's not-found draws in the shell when a member is signed in and in the sign-in pages' layout otherwise; every not-found names itself in the band; the way home takes the product's link style; Account draws in the shell when a workspace is open (KTD1 to KTD4).
- **Authority:** BA-99's acceptance criteria, then `packages/design-system/readme.md` (*Clarity*, *The shell*), then the units.
- **Stop conditions:** drawing the shell around a page outside the shell's route needs the shell's route itself to change. Or a person in no workspace, or the operator in no workspace, loses their way to Account.
- **Execution profile:** one pull request, stacked on BA-101's branch (`liam/ba-101-operator-console`) because both touch `apps/web/src/app/router.tsx`. `Fixes BA-99`, `Merge risk: reversible`. The merge is not armed.
- **Who finishes:** `ce-work` builds it, `ce-code-review` reviews it, and `ce-commit-push-pr` opens the pull request.

---

## Product Contract

### Summary

An unknown address such as `/nothing-here` draws inside the shell for a signed-in member, with the band naming the page *No page at this address* and a link to the member's home. Signed out, or in no workspace, it draws in the sign-in pages' layout with the logo, the same heading and one way on. Inside the shell, every not-found (a page hidden from the role, an address beneath a page, a console address) names itself in the breadcrumb, and its link looks like the product's other links. Account draws inside the shell for a member with a workspace open, and keeps today's layout for a person in no workspace.

### Problem Frame

BA-36's screen review found three dead ends (`docs/dogfood-reports/2026-10-09-ba-36-screen-review.md`, screenshot `f06-unknown-address.png`):

- **F6, P1.** An address no route matches falls to the root's not-found, which draws a bare `h1` and a link at the page's top-left corner, with no logo, padding or shell. The shell's route is pathless, so its own not-found never reaches an address at the top level.
- **F7.** A page hidden from a role, such as `/ask` for an Admin, draws *No page at this address* inside the shell, with an empty breadcrumb, and its *Go to Members* link is underlined where no other link is.
- **F8.** `/account` sits outside the shell's route so a person in no workspace and the operator reach it. A member there loses the band, rail and workspace; the only way back is the link at its foot.

### Requirements

- R1. An unknown address, signed in or out, draws a page with the logo and the same layout as its neighbours, saying what is missing and giving one way on.
- R2. The not-found line inside the shell matches the product's link style, and the band shows where the person is.
- R3. `/account` sits in the shell for a member with a workspace open, so they can move on without its foot link. A person in no workspace still reaches it as today.
- R4. A browser test covers an unknown address signed in and signed out.

### Scope Boundaries

- No change to the shell's route or the console's route, and no top-level catch-all route: the console's own not-found depends on the router's fuzzy not-found reaching it.
- The rail marks no area on a not-found page; there is no area to mark.
- `console-frame.tsx`'s underlined *Back to your workspaces* and the other `text-brand underline` links in the people pages are untouched; they are not the not-found line.
- Account for the operator in the Console draws in the shell of their open workspace when they have one, not in the Console's (see Risks).

---

## Planning Contract

### Key Technical Decisions

- KTD1. **The root's not-found branches on the member read.** A new component replaces the bare `UnknownPage` as `rootRoute`'s `notFoundComponent`. A member read that answers draws `WorkspaceFrame` around `UnknownPage`; a refusal draws `AuthPage` around it. A signed-out visitor's way on is *Sign in* (`/sign-in`), the one next action the readme's *Clarity* asks for. Anyone else refused (in no workspace, or a failed read) gets the existing way home (`/`), which the picker routes onward. The read is asked once (`retry: false`, as `memberRefusal` asks it), so nothing draws only while that one request is in flight; a read paused offline draws as a failed read. The failure detour leaves an unauthenticated read alone outside the pending pages, so a signed-out visitor stays on the page. *Sign in* is kept apart from the way home because a signed-out visitor has no home page yet, and the readme asks for a label naming the effect. Chosen over a catch-all route under the shell, which would send a signed-out visitor to sign-in without saying what was missing and would out-match the console's not-found. Governs R1.
- KTD2. **`Frame` draws a page it is handed in place of the outlet.** `Frame` and `WorkspaceFrame` take an optional `page`, which `ToolbarAndPage` renders instead of `<Outlet />`, with an optional name the shell's keystroke list is titled by (a not-found keeps *this page*, as `home.spec.ts` asserts). That lets a page whose route sits outside the shell draw inside it without moving the route. Governs R1, R3.
- KTD3. **A not-found names itself through the breadcrumb's last-part slot.** `UnknownPage` gives `UNKNOWN_PAGE.heading` through `useBreadcrumbLastPart`, and `partsOf` answers one current part when no place is open and a last part is given. The slot is the frame's, so the one change covers a hidden page, the shell's and the console's not-found and the root's. `GoHome`'s link becomes the kit's link button (`Button` `variant="link"`, as Account's foot link is), which drops the resting underline. Governs R2.
- KTD4. **Account draws in the shell when a workspace is open.** `accountRoute.beforeLoad` warms the member read (`memberRefusal`) after the pending-session check, so the page draws its frame without a flash. Only a member read holding data draws `WorkspaceFrame` around Account, titled *Account*; a refusal, or a read asked again on mount, draws Account as today, so a person in no workspace sees no flash. In the shell, Account keeps its one `h1` and takes the shell's page width, names itself in the breadcrumb, registers its keystrokes with the shell (`usePageKeystrokes`, held steady while its keys are unchanged) rather than taking `?` a second time, and drops its foot row: the band's avatar menu holds *Sign out*, and the band and rail are the way on. The rail marks no area. The passkey offer the shell shows above every page does not draw on Account, the page its link opens (`passkeys.spec.ts` asserts it is absent there). Governs R3.

### Risks

| Risk | Mitigation |
|---|---|
| A page drawn through `page` misses something the outlet gave it, such as route context | `Frame` reads the router's state for the path and the toolbar, both of which still describe the address; the browser tests exercise the shell's band, rail and keystrokes on both pages |
| Account's keystrokes register on every draw and loop | The list is held steady by its keys before it reaches `usePageKeystrokes` |
| The operator with a workspace open opens Account from the Console and lands in their workspace's shell | Recorded in the pull request as a decision the owner may overturn |
| Existing aria snapshots of Account for a member change (no *Sign out*, no page-level keystrokes button) | Updated in the same pull request; the no-workspace snapshots stay as they are |

### Assumptions

- `session.member` refuses a signed-out visitor with the `unauthenticated` class, as `memberRefusal` already relies on.

---

## Implementation Units

### U1. The shell draws a page it is handed, and a not-found names itself

- **Goal:** inside the shell, every not-found shows in the breadcrumb and offers home in the product's link style; the frame can draw a page from outside its route.
- **Requirements:** R2; KTD2, KTD3.
- **Dependencies:** none.
- **Files:**
  - `apps/web/src/app/frame.tsx`: the optional `page`, and the last part given with no place open.
  - `apps/web/src/app/breadcrumb.tsx`: `partsOf` with no place and a last part.
  - `apps/web/src/app/unknown-page.tsx`: the breadcrumb's last part.
  - `apps/web/src/app/go-home.tsx`: the link button.
  - `apps/web/e2e/unknown-address.spec.ts`: new.
- **Patterns to follow:** `member-page.tsx`'s `useBreadcrumbLastPart`; Account's foot link for the link button.
- **Test scenarios:**
  - An Admin at `/ask` sees the not-found heading, a breadcrumb whose one part reads *No page at this address*, and *Go to Members* with no resting underline.

### U2. The root's not-found draws in the shell or the sign-in layout

- **Goal:** an unknown address is never a bare page.
- **Requirements:** R1, R4; KTD1.
- **Dependencies:** U1.
- **Files:**
  - `apps/web/src/app/unknown-page.tsx` (or a sibling in `src/app/`): the branching component, and the *Sign in* way on.
  - `apps/web/src/app/words.ts`: the *Sign in* label beside `UNKNOWN_PAGE`.
  - `apps/web/src/app/router.tsx`: `rootRoute.notFoundComponent`.
  - `apps/web/e2e/unknown-address.spec.ts`.
- **Test scenarios:**
  - Signed out at `/nothing-here`: the logo and product name, the not-found heading, exactly one link, *Sign in*, which opens the sign-in page. The accessibility gate passes.
  - An Admin at `/nothing-here`: the band, the rail and the breadcrumb's not-found part, and *Go to Members*, which lands on Members.
  - A person in no workspace at `/nothing-here`: the sign-in layout, the not-found heading and the way home.

### U3. Account draws in the shell for a member

- **Goal:** a member on Account keeps the band, rail and workspace.
- **Requirements:** R3; KTD4.
- **Dependencies:** U1.
- **Files:**
  - `apps/web/src/app/router.tsx`: `accountRoute`'s warmed member read and its component.
  - `apps/web/src/features/auth/account-page.tsx`: the framed mode.
  - `apps/web/src/features/auth/passkey-offer.tsx`: no offer on Account.
  - `apps/web/e2e/second-factor.spec.ts`: the browser test below, and any member snapshot of Account that changes.
- **Test scenarios:**
  - An Editor opening Account from the avatar menu sees the band, the rail, the workspace switcher and a breadcrumb reading *Account*, and `?` opens the shell's one list holding Account's keystrokes.
  - A person in no workspace still reaches Account from the no-workspace page, in the sign-in layout (existing tests).
  - A member with no passkey sees no passkey offer on Account in the shell (`passkeys.spec.ts`'s offer-link test still passes).

---

## Verification Contract

| Check | Proves | Applies to |
|---|---|---|
| `pnpm --filter @better-answers/web run check` (typecheck, unit tests, the Playwright suite with the accessibility gate) | R1 to R4 | U1 to U3 |
| `pnpm check:gates` | lint, formatting, duplication and the repository gates | U1 to U3 |
| `pnpm check:docs` | the plan's words | all |

---

## Definition of Done

- `/nothing-here` signed out draws the logo, the heading and *Sign in*; signed in it draws in the shell with the band naming it.
- A hidden page's not-found names itself in the band, and its link has no resting underline.
- A member's Account page draws in the shell; a person in no workspace reaches Account as before.
- The new browser tests pass with the rest of the web suite.
