---
title: The Dark Theme - Plan
type: fix
date: 2026-10-10
topic: web-dark-theme
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# The Dark Theme - Plan

## Goal Capsule

- **Objective:** a person can read every page of `apps/web` in a dark theme they chose, or that their device chose for them. Text reads at 4.5:1 and control edges at 3:1, and the choice holds on their next visit with no flash of the other theme.
- **Means:** one attribute on `<html>`, written by one module and by a head script before first paint (KTD1, KTD2). The choice sits on the Account page and is kept on the browser (KTD3). The accessibility gate audits every page a test leaves in both themes, control edges included (KTD5).
- **Product authority:** Linear BA-98's acceptance criteria are R1 to R4. The owner chose on 09/10/2026 to build dark for v0.1. Finding F19 is in `docs/dogfood-reports/2026-10-09-ba-36-screen-review.md`. `packages/design-system/readme.md` §4 and §7 are the design system's own statement of the theme.
- **Stop conditions:** stop and report to the lead if a control edge cannot reach 3:1 in one theme without a token value the other theme cannot share, or if auditing both themes per test pushes the browser suite past CI's timeout.
- **Execution profile:** one pull request, `Fixes BA-98`, in separate commits for the switch, the gate, the control edge and the surface fixes. Reversible: the only data written is a browser's `localStorage` key, and no `contracts/` file, migration or email is involved.
- **Who finishes:** `ce-work` builds it, `/ce-code-review` reviews it, and `ce-commit-push-pr` opens the pull request. The lead queues the merge.
- **Open blockers:** none.

---

## Product Contract

### Summary

`apps/web` sets `data-theme` on `<html>` from a choice of *Match this device*, *Light* or *Dark* on the Account page, kept on the browser. A script in the page's head applies the choice before the stylesheet paints. The bridge stops honouring `.dark`. Field, checkbox, radio and switch edges move to a control-edge token that reads 3:1 in both themes. The dark accent hover keeps white words at 4.5:1. The browser suite's gate audits each page a test ends on in light and in dark, and checks control edges as well as text.

### Problem Frame

No person can reach the dark theme: nothing in `apps/web` sets `data-theme`, and only the tab icon follows the device. BA-36 forced the theme on by hand and found menu items, pills, dates and filter text unreadable and two controls left white (F19). Set on `<html>`, the theme flips nearly everything today (screenshots in this PR's report). The bridge's shadcn aliases are declared on `:root` and resolve there, so an attribute set on any element below `<html>` flips the semantic tokens while the aliases keep their light values. That is the half-flip F19 recorded. `.dark` alone half-flips another way, because the bridge honours it and the tokens and the `dark:` variant do not. Separately, the light theme's field and checkbox edges measure 1.31:1 against the page and the dark theme's 1.35:1, under WCAG 1.4.11's 3:1. The design system lists the dark theme as authored without evidence (readme §7, item 5).

### Requirements

**The choice**

- R1. A person chooses *Match this device*, *Light* or *Dark* on the Account page, in a member's shell and outside it, and the page changes at once.
- R2. The choice persists on that browser across reloads and sign-outs. With no choice made, the page follows the device's `prefers-color-scheme` and follows a change to it while open.
- R3. A page loads in the chosen theme with no frame painted in the other.

**One switch**

- R4. `data-theme` on `<html>` is the one switch. One module writes it, and nothing in `apps/web` or the bridge reads `.dark`.

**Contrast**

- R5. Every page reads at 4.5:1 for text in dark, as axe's `color-contrast` rule measures it, in every state a browser test leaves it in.
- R6. A control identified by its edge (a field, select, checkbox, radio or switch) reads at 3:1 against what is behind it, in both themes. A control identified by its own words is exempt.
- R7. Focus reads at 3:1 in dark, as BA-97 proved it in light.
- R8. A hovered or pressed primary or accent fill keeps white words at 4.5:1 in dark.

### Key Decisions

- **Default to the device.** A person who never chooses gets the theme their device asks for. `sign-in.spec.ts`'s "keeps the sign-in page light under a dark OS" came from d85f8cd6, which guarded against Tailwind's media-query `dark:` half-flipping a light page; following the device supersedes its reason. Governs R2. The owner may overturn this for light-unless-chosen.
- **Kept on the browser, not the account.** A server-side preference would need a column on the person and a migration, and the sign-in pages would still have no person to read it from. The owner may overturn this. Governs R2.
- **Control edges at 3:1 in light too.** The gate cannot check one theme and leave the other at 1.31:1, and a 1px line in a darker grey is still a hairline. This lands in its own commit so the owner can revert the light half. Governs R6.

### Scope Boundaries

- The consent page that `apps/api` draws (F34) is ba-102's; whether it follows the theme is a follow-up.
- `NoiseTexture` on dark surfaces stays unbuilt (readme §4).
- The tab icon keeps following `prefers-color-scheme`. The tab strip is the device's, not the page's.

#### Deferred to Follow-Up Work

- Following the theme on the api's consent page, filed in Linear Triage once ba-102 lands.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **The attribute lives on `<html>` because the aliases resolve at `:root`.** The bridge's §1 aliases (`--background: var(--surface-page)` and the rest) compute on the root element. The writer sets `document.documentElement.dataset.theme` and nothing else, and the bridge's §2 comment says why. Widening the alias selector to `[data-theme]` would make a subtree switch work, which R4 does not want.
- KTD2. **A head script from the Vite plugin, not a hand-written one.** `vite.config.ts`'s `theTab` plugin already writes the head. It injects one inline script, built from the same storage key and values the hook imports from `apps/web/src/shared/theme.ts`, so the key has one source. The api sends only `frame-ancestors 'none'` (`apps/api/src/ingress/spa.ts`), so an inline script runs. A future `script-src` policy would need the script's hash, and the plan's report says so.
- KTD3. **The key is `better-answers.theme`, holding `light`, `dark` or nothing.** Nothing means the device decides. It follows `menu-showing.ts`'s convention and reads and writes through `shared/browser-storage.ts`, so a blocked store costs the choice and never the page. A `storage` event from another tab applies there too.
- KTD4. **A module-level store under `useSyncExternalStore`.** The Account page's choice and the device follower share one state without a context provider. The follower is mounted in `Providers`, not in `app/frame.tsx`, which ba-114 is editing, so it also runs on pages outside the shell.
- KTD5. **The gate audits the other theme as well as the page's own.** After its audit, the gate flips `<html>` to the other theme, waits for transitions, audits again, and restores the page's theme. Every state a spec leaves, including open menus, dialogs and sheets, is then checked in dark at the cost of one extra axe pass per test. This replaces the skill's "No light/dark matrix" stance. A second Playwright project would run every test twice.
- KTD6. **Control edges are measured in the page, not by axe.** Axe's `color-contrast` reads text only. The gate composites each boundary-identified control's edge, and its fill, over the colour behind it, and requires one of the two to reach 3:1, using the contrast formula `e2e/locators.ts` already holds. Disabled controls, and checkboxes, radios and switches that hold their own words, are exempt.
- KTD7. **A `--border-control` token, read by the kit through `--input`.** `--input` is the shadcn name every field, select, checkbox and radio reads. Pointing it at a new `--border-control` (3:1 in both themes) moves them all with no kit edit. The outline button, which also reads `border-input`, keeps the `--border-default` hairline that `sign-in.spec.ts` and `blueprint-parts.spec.ts` pin, through one arrival edit in `button.tsx`.
- KTD8. **The kit's `dark:` utilities give way to the tokens.** They were written against shadcn's dark palette: fields at `bg-input/30`, a destructive badge at 60%. With `--input` now a mid grey, `dark:bg-input/30` would raise every field. Each `dark:` utility that re-colours what the tokens already flip is removed, and each removal is recorded in `THIRD_PARTY_NOTICES.md`. The `@custom-variant dark` stays bound to `[data-theme="dark"]` for kit items still to arrive.

### Assumptions

- The full browser suite with one extra axe pass per test stays inside CI's job timeout. BA-97's run was 404 tests. The run in U3 measures it.
- The dark failures beyond the known ones (accent hover, kit `dark:` utilities) are few, because the theme flips nearly everything when set on `<html>`. U5 is sized by the failure list U3's run produces.

### Sequencing

U1 and U2 make the theme reachable. U3 makes the suite see both themes and produces the failure list. U4 moves the control edge. U5 fixes what U3 and U4 report. U6 updates the design system's and the suite's own docs.

---

## Implementation Units

### U1. The switch and the head script

- **Goal:** one module owns the theme. It reads the kept choice, resolves it against the device, writes `<html data-theme>`, follows the device and other tabs, and the head applies it before first paint.
- **Requirements:** R2, R3, R4. KTD1 to KTD4.
- **Files:** `apps/web/src/shared/theme.ts` (new: key, values, resolve, the head script's source, the store and hook), `apps/web/vite.config.ts` (inject the script), `apps/web/src/app/providers.tsx` (mount the follower), `apps/web/src/index.css` (`html` background from `--background`), `packages/design-system/tokens/tailwind-bridge.css` (drop `.dark`, rewrite §2's comment), `apps/web/test/theme.test.ts` (new), `apps/web/e2e/sign-in.spec.ts` (rewrite the dark-OS test).
- **Approach:** the head script and the hook share one resolve function's rule: a kept `light` or `dark` wins, otherwise the device. The script is tiny, guards a throwing store, and is placed before the stylesheet link.
- **Test scenarios:**
  - The head script, run in jsdom with `dark` kept, sets `data-theme="dark"` on `<html>`. With nothing kept and the device dark, it sets dark. With a store that throws, it follows the device.
  - The hook, under *Match this device*, rewrites the attribute when the device's media query changes, and stops once a theme is chosen.
  - A `storage` event carrying a choice applies it.
  - `data-theme` is written by `shared/theme.ts` alone, and `.dark` appears nowhere in `apps/web/src` or the bridge (a source scan in the style of `blueprint-in-one-place.test.ts`).
  - A dark OS paints the sign-in page in the dark tokens, and a light OS in the light ones (replaces "keeps the sign-in page light under a dark OS").
- **Verification:** web `typecheck` and `test` pass.

### U2. The choice on the Account page

- **Goal:** the Account page offers *Match this device*, *Light* and *Dark* as one radio group, applied at once and kept.
- **Requirements:** R1, R2, R3.
- **Files:** `apps/web/src/features/auth/account-page.tsx`, `apps/web/src/features/auth/account-words.ts`, a theme section beside the sign-in section, `apps/web/test/account-page.test.tsx`, `apps/web/e2e/dark-theme.spec.ts` (new).
- **Approach:** a titled section after *Sign-in*, in both render paths, using `shared/ui/radio-group.tsx` and the words table.
- **Test scenarios:**
  - Picking *Dark* on the Account page turns the page dark at once. After a reload the radio still reads *Dark* and the page is dark.
  - Signed out, the sign-in page opens dark for a browser that kept *Dark*.
  - With *Match this device* and an emulated dark scheme the page is dark, and switching the emulation to light turns it light without a reload.
  - No flash: with the page's own scripts blocked, a browser that kept *Dark* still gets `data-theme="dark"` and the dark page colour from the head script and stylesheet alone.
  - The section is reachable and operable by keyboard, with arrow keys moving the choice.
- **Verification:** the spec passes on the local port. The unit test reads the radio group's state from the store.

### U3. The gate audits both themes

- **Goal:** every test's closing audit runs in light and in dark, and checks control edges, so contrast holds by test.
- **Requirements:** R5, R6, R7. KTD5, KTD6.
- **Files:** `apps/web/e2e/browser.ts`, `apps/web/e2e/locators.ts` (the edge measurement beside `contrastBetween`), `apps/web/e2e/accessibility-gate.spec.ts`, `apps/web/e2e/focus-ring.spec.ts`.
- **Approach:** the audit runs once per theme, the page's own first. A failure names the theme it was in. The focus walk runs once more under dark.
- **Test scenarios:**
  - `test.fail()`: a page whose heading is legible in light and painted near-black only under `[data-theme="dark"]` fails the gate in its dark pass.
  - `test.fail()`: a field whose edge is painted the page's own colour fails the edge check.
  - A page left in dark by its test is audited in light too, and is restored to dark afterwards.
  - The focus walk, in dark, finds one ring per stop with an edge of at least 3:1.
- **Verification:** the whole browser suite runs once with the new gate, and its failures become U4's and U5's work list.

### U4. The control edge

- **Goal:** fields, selects, checkboxes, radios and switches draw their edge at 3:1 in both themes, and outline buttons keep the hairline.
- **Requirements:** R6. KTD7, KTD8.
- **Files:** `packages/design-system/tokens/semantic.css` (`--border-control` in both themes), `packages/design-system/tokens/tailwind-bridge.css` (`--input`), `apps/web/src/shared/ui/button.tsx`, `apps/web/src/shared/ui/input.tsx`, `select.tsx`, `checkbox.tsx`, `radio-group.tsx` (drop `dark:bg-input/30`), `apps/web/src/shared/ui/THIRD_PARTY_NOTICES.md`.
- **Test scenarios:** covered by U3's edge check across the suite. `sign-in.spec.ts`'s "draws the outline edge hairline" still passes.
- **Verification:** U3's edge check passes on every page the suite visits.

### U5. The dark surfaces

- **Goal:** every failure U3's run reports in dark is fixed at the token or at the kit utility that diverges from it.
- **Requirements:** R5, R8. KTD8.
- **Files:** `packages/design-system/tokens/semantic.css` (`--control-accent-bg-hover` in dark), the `shared/ui/` files the run names, `apps/web/e2e/blueprint-parts.spec.ts` (hovered accent fills in dark).
- **Approach:** fix by token first, by the kit's `dark:` utility second, and in a page's own markup last.
- **Test scenarios:**
  - The hovered primary button and the hovered accent button, in dark, keep white words at 4.5:1.
  - Each failure U3 reported passes under the gate.
- **Verification:** the whole browser suite is green with the two-theme gate.

### U6. What the design system and the suite say

- **Goal:** the readme, the dark colours card and the browser-suite skill describe the theme as built and measured.
- **Requirements:** R4 to R7.
- **Files:** `packages/design-system/readme.md` (§4 Colour, §7 item 5), `packages/design-system/guidelines/colors-dark.card.html` if a token moved, `.claude/skills/browser-suite/SKILL.md` (the gate paragraph and *Theme runs*), `apps/web/CODING_STANDARDS.md` (the one switch).
- **Approach:** edits to the readme, the cards and the skill go through `ce-skill-work`.
- **Test expectation:** `apps/web/test/browser-suite-skill.test.ts` and `pnpm check:docs` hold the skill and the words gate.

---

## Verification Contract

| Gate | Command | When |
|---|---|---|
| Web types and units | `pnpm --filter @better-answers/web run typecheck` and `run test` | After each unit |
| Browser suite | `pnpm --filter @better-answers/web exec playwright test -c playwright.local.config.ts` (an uncommitted copy of the config on port 3233), after `run build` | After U3, U4 and U5, and on the pushed head |
| Gates | `pnpm check:gates` | Before push |
| Docs and words | `pnpm check:docs` | Before push |
| Contrast by eye and by number | agent-browser screenshots of every area in dark, with contrast read off the gate's measurements | Before push, into the report |

A latency budget that fails under load is rerun alone on untouched code before it counts.

## Definition of Done

- R1 to R8 hold, each proved by a test named in its unit.
- The browser suite passes with the two-theme gate on the pushed head, and the gate's new failing cases fail for their own reason.
- `pnpm check:gates`, `pnpm check:docs` and the web `check` pass on the pushed head.
- Probe specs, the local Playwright config and any experimental code are gone from the diff.
- BA-98 is In Review with the pull request linked, and follow-ups are filed in Triage.
