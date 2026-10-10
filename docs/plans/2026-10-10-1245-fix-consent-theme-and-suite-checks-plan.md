---
title: The Consent Page Follows the Theme, and Two Suite Checks Tighten - Plan
type: fix
date: 2026-10-10
topic: consent-theme-and-suite-checks
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# The Consent Page Follows the Theme, and Two Suite Checks Tighten - Plan

## Goal Capsule

- **Objective:** a person who chose the dark *theme* meets it on the consent page and its refusal pages too (BA-120); the accessibility gate reads a control's edge as it is painted (BA-123); and a seed the harness cannot write tells the spec's author why (BA-107).
- **Means:** three units in one pull request, built in the order U1, U2, U3, so the dark consent page is measured by the tightened check.
- **Authority:** the three issues' acceptance criteria, then the units.
- **Stop conditions:** the tightened edge check fails a page that passes on `main` today. Name the page to the lead before changing the page or the check.
- **Execution profile:** one pull request, `Fixes BA-120`, `Fixes BA-107`, `Fixes BA-123`, `Merge risk: reversible`. The merge is not armed.
- **Who finishes:** `ce-work` builds it, `ce-code-review` reviews it, and `ce-commit-push-pr` opens the pull request.

---

## Product Contract

### Summary

The three issues share the browser suite. BA-98 gave the SPA its theme switch and the gate its light-and-dark audit and control-edge check. BA-102 drew the api's consent page from the design system's stylesheet, so the dark tokens already reach it, but nothing on that page sets `data-theme`, and it is light for everyone. BA-98's review named two shapes the edge check still reads as stronger than they paint. BA-36's screen review met two seeds the harness answered with a bare 500.

### Problem Frame

- **The consent page.** The theme is kept on the browser, in `localStorage` under `better-answers.theme`, and falls back to the device's colour scheme. The SPA's head script, `FIRST_PAINT` in `apps/web/src/shared/theme-switch.ts`, sets `data-theme` on `<html>` before the first paint. The api renders `/consent` and the refusal pages itself (`apps/api/src/auth/pages.ts`), outside the SPA, and cannot read `localStorage`. A person who chose dark is taken from a dark sign-in page to a light consent page.
- **The edge check.** `controlEdges` in `apps/web/e2e/locators.ts` counts the borders of a control's parent when the parent holds no words of its own. That is how Jump to's field is found by its row's rule. A census of the suite on `a687b8da` found the rule lent in one more place, the audit log's filter toolbar, whose bottom hairline sits 13px under its one select. That is a layout's border, not a field's edge, and it is harmless there only because the select has an edge of its own. The check also composites backgrounds up the DOM but not an ancestor's `opacity`, so a control in a dimmed container measures at full strength. No page dims a container around an enabled control today.
- **The harness.** `POST /__harness/connected-sources` with `kept: true` on a `default-on` *finding* trips the `finding_restore_check` constraint. An `unreadableReason` with a space fails the factory's pattern. Both answered 500 with no reason, and `ask` in `apps/web/e2e/harness.ts` reports only the status, so the author went to the server's log.

### Requirements

BA-123:

- R1. A wrapper lends a side to a field only where that side hugs the field's own.
- R2. An ancestor's opacity is composited into the edge, the fill and what is behind.
- R3. Each of R1 and R2 has a `test.fail()` case in `apps/web/e2e/accessibility-gate.spec.ts` that fails for its own reason.
- R4. Every page that passes the gate on `main` still passes it.

BA-107:

- R5. The harness validates what it can before it writes, and answers 400 naming the field and the rule.
- R6. A constraint failure inside a harness write answers 400 with the constraint's name.
- R7. The types in `apps/web/e2e/harness.ts` allow only the combinations the store accepts, where a type can say so.
- R8. A spec whose seed is refused reads the reason in its own failure.

BA-120:

- R9. With the dark theme chosen, the consent page and the refusal pages draw dark.
- R10. The page sets `data-theme` before the first paint without loading the SPA, by the rule the SPA uses, from one source the api and the web both read.
- R11. The consent flow's browser spec covers the dark page, and it passes the accessibility gate.

### Scope Boundaries

- The theme stays on the browser. No column, no migration and no cookie.
- The api's pages set the theme once, as they load. They do not follow a device that changes while the page is open, as the SPA does. A consent page is read and left.
- The harness's other routes keep their schemas. They gain only the shared 400.
- The gate's rule changes; no page's markup does.

### Deferred to Follow-Up Work

- A type cannot say that a string holds no space, so `unreadableReason` stays a `string` and the 400 names its rule.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **A wrapper's side counts only where it runs less than 8px from the field's own side, box edge to box edge.**
  - BA-123 says a wrapper lends its edge when its box is the field's, within a few pixels. Jump to's row is 36px wider than its field on the left and 48px on the right, for the search icon and the close button, so a whole-box test would drop the one edge that field has. Its bottom rule runs 4.5px under the field.
  - Measured side by side, the rule keeps Jump to and drops the audit log's toolbar hairline at 13px, and any container with padding of 8px or more beside its border.
  - Governs R1, R4.
- KTD2. **Opacity is composited as a group.** An element at opacity `a` shows `a` of everything painted inside it and `1 - a` of what was behind it. One walk from `<html>` down to the control gives the edge, the fill and what is behind, each through every dimmed ancestor. Governs R2.
- KTD3. **The harness answers every refusal from one error handler.** A body its schema refuses, a row the factory's boundary schema refuses and a Postgres integrity violation each answer 400 with JSON: the fields and their rules, or the constraint's name. Anything else stays a 500. The connected-source schema checks the two known cases before any write. Governs R5, R6.
- KTD4. **The theme's rule moves to `packages/schema/src/theme.ts`, exported as `@better-answers/schema/theme`.**
  - It holds where the choice is kept, the device query, `themeShown` and `FIRST_PAINT`. `apps/web/src/shared/theme-switch.ts` re-exports them and keeps `showTheme`, so it stays the one writer of `data-theme` in the SPA and every import of it stands.
  - `packages/schema/src/email-code.ts` is the precedent: a contract the api enforces and the web reads, under its own subpath. The schema package's `src/` is already in the api's image and is type-checked.
  - The file imports nothing and uses erasable syntax only: Vite's config loader leaves a workspace import external, so Node loads the file itself when `vite.config.ts` is read. The file's own comment says so.
  - Chosen over the design system, which is the theme's home by meaning but ships only CSS and assets, has no type check, and reaches the api's image file by file.
  - Governs R10.
- KTD5. **The shell inlines the script first in `<head>`, ahead of the stylesheet.** The consent page's content security policy is `frame-ancestors 'none'` alone, with no `script-src`, so an inline script runs. Governs R9, R10.

### Risks

| Risk | Mitigation |
|---|---|
| The tightened check fails a page on `main` | The census found two lent sides and no dimmed field; the whole suite runs after U1 and before U3 |
| A later `script-src` on the api's pages blocks the inline script | The browser spec fails when the script does not run |
| The sibling changes edit `apps/web/e2e/harness.ts` or `locators.ts` | Edits there stay small and local; whichever pull request merges second rebases |

### Assumptions

- `vite.config.ts` loads a workspace package's TypeScript when it reads the head script. The web build proves it.
- Hono keeps a mounted router's own error handler, so the harness's 400 holds behind `apps/api/tests/serve.ts`. A browser spec proves it.

---

## Implementation Units

### U1. The gate reads a control's edge as painted

- **Goal:** `controlEdges` lends a wrapper's side only where it hugs the field, and composites ancestor opacity.
- **Requirements:** R1, R2, R3, R4; KTD1, KTD2. Covers BA-123's three criteria.
- **Dependencies:** none.
- **Files:**
  - `apps/web/e2e/locators.ts`: `controlEdges`.
  - `apps/web/e2e/accessibility-gate.spec.ts`: two `test.fail()` cases and one passing case.
  - `.claude/skills/browser-suite/SKILL.md`: the gate's rule, the `controlEdges` row and the count of the gate's own tests, through `ce-skill-work`.
- **Approach:**
  1. Write the two fixtures first and watch each print *Expected to fail, but passed* on the untouched check. That shows each fails for its own reason.
  2. Change the check, then run the whole suite.
- **Patterns to follow:** `drawAFieldWithNoEdgeOnATint` and its test in `accessibility-gate.spec.ts`.
- **Execution note:** test first.
- **Test scenarios:**
  - Refuses two edgeless fields in a padded box whose own border is strong: `test.fail()`.
  - Refuses a wordless checkbox with a control's true edge inside a box dimmed to a third: `test.fail()`. Axe already refuses a dimmed field by its words, so a field would not show the edge check alone.
  - Passes an edgeless field whose row draws a strong rule a few pixels under it, as Jump to's does.
  - Existing: every spec still passes the gate, `jump-to.spec.ts` and `audit-log.spec.ts` among them.
- **Verification:** the whole browser suite on port 3232.

### U2. A seed the harness refuses says why

- **Goal:** 400 with the field and rule, or the constraint's name, and the reason in the spec's failure.
- **Requirements:** R5, R6, R7, R8; KTD3. Covers BA-107's three criteria.
- **Dependencies:** none.
- **Files:**
  - `apps/api/tests/harness-control.ts`: the error handler, and `readBody`'s refusal.
  - `apps/api/tests/harness-sources.ts`: a kept or overridden finding is `always` tier; an unreadable reason matches `UNREADABLE_REASON`.
  - `apps/api/tests/harness-control.test.ts`: the 400s.
  - `apps/web/e2e/harness.ts`: `ask` puts the answer's body in its message; `SeedFinding` offers `kept` and `overriddenByErasure` on the `always` tier alone.
  - `apps/web/e2e/sources.spec.ts`: a refused seed says why and writes nothing.
  - `.claude/skills/browser-suite/SKILL.md`: what a refused seed answers, through `ce-skill-work`.
- **Patterns to follow:** `harnessAnswer` in `harness-control.test.ts`; `inOneTransaction` already rolls a failed seed back.
- **Test scenarios:**
  - Answers 400 naming `kept` and its rule to a kept `default-on` finding, and writes no connected source.
  - Answers 400 naming `unreadableReason` and its rule to a reason with a space.
  - Answers 400 naming the constraint to a seed whose workspace id is well-formed but held by no workspace.
  - Answers 400 naming the field to a body another route's schema refuses.
  - In the browser suite, a refused seed's failure names the field and the rule, and the Sources page shows nothing connected.
- **Verification:** `pnpm check:api`; the browser suite.

### U3. The api's pages paint the theme a person chose

- **Goal:** the consent page and the refusal pages set `data-theme` before the first paint, from the SPA's own rule.
- **Requirements:** R9, R10, R11; KTD4, KTD5. Covers BA-120's three criteria.
- **Dependencies:** U1, so the dark consent page is measured by the tightened check.
- **Files:**
  - `packages/schema/src/theme.ts` and `packages/schema/package.json`: the rule and its subpath.
  - `apps/web/src/shared/theme-switch.ts`: re-exports the rule, keeps `showTheme`, and its header comment is rewritten to match.
  - `apps/api/src/auth/pages.ts`: the shell's head script.
  - `apps/api/tests/auth-pages.test.ts`: every page carries the script once, ahead of the stylesheet.
  - `apps/web/e2e/consent.spec.ts`: the dark consent page and the dark refusal pages.
  - `apps/web/CODING_STANDARDS.md`: where the rule lives and who inlines it.
- **Patterns to follow:** `keptOnThisBrowser` in `apps/web/e2e/dark-theme.spec.ts`; the logo and stylesheet the shell already inlines.
- **Test scenarios:**
  - A person who kept dark, on a light device, opens the consent page: `data-theme` is `dark`, the page paints the dark `--surface-page`, no SPA script is on the page, and the accessibility gate passes.
  - The same person's session ends and they press Connect: the *Sign in again* refusal draws dark, and the gate audits it.
  - A form sent to `/consent` from another origin: the *Nothing was connected* refusal draws dark, and the gate audits it.
  - With nothing kept, the consent page follows a dark device.
  - In the api's suite, the consent page and each of the two refusal forms, `refusedPage` and `signInPage`, carry the shared script exactly once, before the stylesheet.
  - Existing: `apps/web/test/theme.test.ts` and `dark-theme.spec.ts` still pass through the re-export.
- **Verification:** the web `check`, `pnpm check:api`.

---

## Verification Contract

| Check | Proves | Applies to |
|---|---|---|
| The web `check`: typecheck, unit tests and the whole browser suite, on port 3232 | R1 to R4, R7 to R11 | U1, U2, U3 |
| `pnpm check:api` | R5, R6, R10 | U2, U3 |
| The schema package's typecheck | the new subpath | U3 |
| `pnpm check:gates` | lint, formatting and the repository gates | all |
| `pnpm check:docs` | this plan's words and the standards' | all |

---

## Definition of Done

- The two new gate cases fail for their own reasons, and the whole suite passes on the tightened check.
- A refused seed answers 400 with its reason, and a spec's failure shows it.
- The consent page and the refusal pages draw dark for a person who chose dark, from the one rule the SPA uses.
- Every check in the Verification Contract passes on the head that is pushed.
