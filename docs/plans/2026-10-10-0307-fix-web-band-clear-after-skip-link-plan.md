---
title: A Target Stays Clear of the Sticky Band After the Skip Link - Plan
type: fix
date: 2026-10-10
topic: web-band-clear-after-skip-link
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# A Target Stays Clear of the Sticky Band After the Skip Link - Plan

## Goal Capsule

- **Objective:** after *Skip to the page*, or any other jump to `#page`, no control above `main` is left partly under the wide band, whatever the page's height (BA-114).
- **Means:** a jump to the page lands at the top of the page's column, so the passkey offer and the toolbar's tabs stay in view below the band (KTD1).
- **Authority:** BA-114's acceptance criteria, then the units.
- **Stop conditions:** Chromium does not land a jump at the column's top with the margin in KTD1, or a spec other than *keeps a focused control clear of the fixed band* and *is keyboard-reachable and axe-clean under its group* starts failing on the change.
- **Execution profile:** one pull request, `Fixes BA-114`, `Merge risk: reversible`. The merge is not armed.
- **Who finishes:** `ce-work` builds it, `ce-code-review` reviews it, and `ce-commit-push-pr` opens the pull request.

---

## Product Contract

### Summary

Where the layout is wide, the band is `sticky top-0`, and `scroll-padding-top` stops a control scrolled into view below it. A jump to `#page` scrolls `main` up to the band's foot. When the page is only a little taller than the viewport, the jump cannot scroll that far. The scroll stops partway, and the passkey offer's link and dismiss button, or the toolbar's tabs, are left straddling the band's foot. axe's `target-size` check (WCAG 2.5.8) then fails on them, so the accessibility gate depends on the page's height.

### Problem Frame

Reproduced on `084849c0` at Playwright's 1280 by 720 viewport. The page was Models and spend, for an Admin who is offered a passkey. A spacer was grown at the foot of the page, and the skip link was pressed at each height. The depths below are how far the jump scrolled, not the spacer's height. Some depths left a target crossing the band's foot:

- From 29px to 54px, the offer's *Add a passkey* link.
- From 79px to the sweep's end at 89px, the tabs *Model choices* and *Spend*. A sweep at 1440 by 600 showed them crossing until 103px, short of the full depth of 114px.

axe's `target-size` failed on the link and on the dismiss button from 54px to 79px. That includes depths where a target ran off the top of the viewport while the band covered the rest of it. axe passes a target the band encloses entirely, and it counts as obscuring only the band's own controls, not its background.

BA-97 found this as two specs passing or failing by a few pixels of page height. S2a's taller Knowledge pages will meet it.

### Requirements

- R1. After `skipLinkReachesThePage` on a page tall enough to scroll, the band partly covers no focusable target above `main`. That covers the passkey offer's link and dismiss button, and the toolbar's tabs.
- R2. A browser spec proves R1 on a page made taller than the viewport. It does not depend on the page's exact height.

### Scope Boundaries

- Only the wide layout. The narrow band is not sticky, so it covers nothing.
- This change does not touch focus scrolling within the page. *Keeps a focused control clear of the fixed band* in `frame.spec.ts` is Shift+Tab focus scrolling under `scroll-padding-top`, not a jump to `#page`. Its height sensitivity is a separate mechanism (Deferred, below).

### Deferred to Follow-Up Work

- If *keeps a focused control clear of the fixed band* is still sensitive to height after this change, file a Triage issue with the heights measured.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **`main` takes a `scroll-margin-top` of one viewport's height in the wide layout.** The rule sits in `apps/web/src/index.css`, beside the `scroll-padding-top` rule it qualifies.
  - A jump to an element aligns its margin edge with the band's foot. Any margin at least as tall as what sits above `main` therefore lands the jump at the top of the column. At the top, the passkey offer and the toolbar sit below the band.
  - The margin also covers the passkey offer's dismissal, which focuses `main`, and a typed `#page` address.
  - A viewport's height is the largest head that can still show below the band at the top of the column, so it is the honest bound when the head is not measured.
  - Chosen over two alternatives:
    - A minimum height on `main`, so that every jump reaches full depth and the band covers the head entirely. That would hide the page's own tabs after a skip, and give every short page a vertical scrollbar.
    - `focus({ preventScroll: true })` on the skip link's click. That misses the dismissal and any fragment jump.
  - Governs R1.
- KTD2. **The spec sweeps the depth the jump can reach, rather than choosing a height.**
  - The page is Models and spend, for an Admin offered a passkey, at the suite's viewport. A spacer at the foot of the page's content grows in steps of 4px through one viewport's height. A step that size lands inside every window the reproduction measured, the narrowest being about 10px.
  - The first press is `skipLinkReachesThePage`. Later presses focus the skip link and press Enter.
  - At each step, every focusable element above `main` and outside the band must be either enclosed by the band's box or clear of it. That is R1's line. It is stricter than axe, which counts only the band's own controls as obscuring, not its background.
  - The test ends on the page, so the automatic gate audits the last step.
  - Governs R2.

### Risks

| Risk | Mitigation |
|---|---|
| A future part scrolls `main` into view and expects it at the band's foot | Nothing in `apps/web/src` does so today; the rule's comment says what the margin is for |
| A head taller than the viewport would put `main` below the fold after a jump | No head approaches that; the offer and the toolbar together are about 120px |

### Assumptions

- Chromium honours `scroll-margin-top` for a fragment jump and for `focus()`, and clamps the result at the document's top. Before the spec was written, a probe on the change showed the scroll staying at 0 and axe's `target-size` clean at every spacer height from 0 to 400px.

---

## Implementation Units

### U1. A jump to the page keeps the page's head in view

- **Goal:** no target above `main` is partly under the band after a jump to `#page`, at any page height.
- **Requirements:** R1, R2; KTD1, KTD2.
- **Dependencies:** none.
- **Files:**
  - `apps/web/src/index.css`: the `main` margin in the wide-layout block, with a comment saying why.
  - `apps/web/e2e/frame.spec.ts`: the sweep test, beside *moves focus from the skip link into the content*.
- **Approach:**
  1. Write the test first and watch it fail on the untouched stylesheet at a depth inside the ranges in the Problem Frame.
  2. Add the rule, rebuild, and watch the test pass.
  3. Rerun *keeps a focused control clear of the fixed band* and *is keyboard-reachable and axe-clean under its group* at a few viewport heights, and record what they show.
- **Patterns to follow:** `focusAgainstTheBand` in `frame.spec.ts` for reading boxes against the band.
- **Execution note:** test first. Follow the `browser-suite` skill: a title of ten words at most, and the words read from the SPA's word tables.
- **Test scenarios:**
  - An Admin offered a passkey, on Models and spend: at every spacer height through one viewport's height, the band neither partly covers the offer's link, its dismiss button nor the tabs after the skip link, and `main` has focus.
  - The accessibility gate passes on the page at the sweep's last height.
  - Existing: *moves focus from the skip link into the content* and every spec that calls `skipLinkReachesThePage` still pass.
- **Verification:** the web `check` passes. Root `check:gates` and `check:docs` pass.

---

## Verification Contract

| Check | Proves | Applies to |
|---|---|---|
| `pnpm --filter @better-answers/web run check` (typecheck, unit tests, the Playwright suite with the accessibility gate) | R1, R2 | U1 |
| `pnpm check:gates` | lint, formatting and the repository gates over the edits | U1 |
| `pnpm check:docs` | the plan's words | U1 |

---

## Definition of Done

- A jump to `#page` in the wide layout leaves the page's head below the band at every page height.
- The sweep test fails without the rule and passes with it.
- The web suite passes.
