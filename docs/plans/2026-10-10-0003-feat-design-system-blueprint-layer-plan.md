---
title: The Blueprint Layer - Plan
type: feat
date: 2026-10-10
topic: design-system-blueprint-layer
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# The Blueprint Layer - Plan

## Goal Capsule

- **Objective:** a page in `apps/web` reads as the blueprint the design system specifies, and a keyboard user can see where focus is on every control. S2a's Search and concept pages then build on the frame, the marked card and the grid rather than on stock shadcn surfaces.
- **Means:** one mark rule and two texture rules in the design system's stylesheet (KTD1, KTD4), a focus token that shows its edge and wins over the kit's rings (KTD2), shadcn's `card` with a `marks` prop (KTD3), and `Frame`, `GridPattern` and `DotPattern` in one shared file (KTD4).
- **Product authority:** Linear BA-97 is authoritative: its acceptance criteria are R1 to R8. `packages/design-system/readme.md` §4 and `guidelines/blueprint-marks.card.html` are the specification. Findings F1, F2, F3, F15, F30 and F31 are in `docs/dogfood-reports/2026-10-09-ba-36-screen-review.md`.
- **Stop conditions:** stop and report to the lead in either case:
  - No arrangement of the two focus colours reaches 3:1 against both the page and the primary fill.
  - Hiding the substrate from the accessibility audit (KTD5) turns out to hide a contrast failure that is not the substrate's.
- **Execution profile:** one pull request, `Fixes BA-97`, reversible: no data, no `contracts/`, no email.
- **Who finishes:** `ce-work` builds it, `/ce-code-review` reviews it, and `ce-commit-push-pr` opens the pull request. The lead queues the merge.
- **Open blockers:** none.

---

## Product Contract

### Summary

The design system's stylesheet gains the registration mark, the grid substrate and the dot texture, each keyed on a data attribute. `apps/web` gains `Card` from the shadcn registry with an opt-in `marks` prop, and `Frame`, `GridPattern` and `DotPattern` of its own. The primary button carries its marks, and a new `accent` variant is the same fill without them. The focus token draws its 1px ink edge outside its pale ring and wins over the kit's ring utilities. The sign-in pages sit in a marked card on the grid with one treatment for their secondary actions. The refusal line loses its coloured left border, and the rail's open area is marked in greyscale.

### Problem Frame

BA-36's review found no page carrying the blueprint register (F1): the `--mark-*` and `--grid-*` tokens ship and nothing reads them, and there is no `card.tsx`. The sign-in pages sit top-left with most of the viewport empty (F2) and use three treatments in one row of secondary actions (F3). The rail's open area is the heaviest object on every page (F15). The sign-in refusal has a coloured left border, which the system bans (F30). The kit's 3px half-alpha focus ring is about 2.3:1 against the page, under WCAG 1.4.11's 3:1, and the system's own token, written as it is, paints its 2px pale ring over its 1px ink edge, so making it win as written would measure worse (F31). S2a's web units wait on this package.

### Requirements

**The blueprint parts**

- R1. `Frame`, `Card` with `marks`, and `GridPattern` exist and are the only way a page draws a framed region, a card or the substrate. `DotPattern` exists for bounded empty areas.
- R2. A mark is a `+` of 7px arms and 1px weight centred on each corner of its object, drawn only on an object the readme's rationing allows. No object inside a marked parent draws marks, and no page draws more than three marked objects.
- R3. The primary button carries its marks. A committing action repeated per row uses the unmarked `accent` fill.
- R4. `GridPattern` draws the 32px module behind the page, one per page, never inside a card or dialog.

**Focus**

- R5. Focus on every control meets 3:1 against its background, measured in the browser.

**The sign-in pages and the shell**

- R6. The sign-in pages sit in a frame, and each row of secondary actions uses one treatment.
- R7. The sign-in refusal line has no coloured left border.
- R8. The rail's open area is marked in greyscale, not a solid near-black square.

### Scope Boundaries

- `NoiseTexture`: no dark or accent surface is reachable yet (BA-98).
- The dark theme's surfaces. The dark focus token is corrected in step with the light one (KTD2) but not measured, since nothing sets `data-theme` (BA-98).
- The non-modal evidence panel in `shared/ui/sheet.tsx`, which is S2a U11's own.
- Moving existing empty states onto `DotPattern`. S2a's U11 adopts it for Search's empty state.
- One primary at a time on the setup page (BA-106).
- Masking the grid from reader prose: no page renders reader prose yet. S2a's U12 masks it on the concept page when that lands, on the element `GridPattern` wraps.
- Bordered blocks that are not cards stay as they are: a sunken fieldset or quoted passage, a `kbd`, the authenticator's QR box, and the invite dialog's scrolling address list.

### Deferred to Follow-Up Work

- A lint rule for "a card is `Card`". R1 is held by a unit test that scans the source (U5), which is enough until a rule in `packages/devtools` earns its keep.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **A mark is one stylesheet rule on `[data-marks]`, in `packages/design-system/styles.css`.** It draws all four `+` with one `::before` holding eight no-repeat gradient bars, so it adds no DOM and survives `asChild`. The host takes `position: relative`. The ink is `--mark-ink`, which defaults to `--mark-color`; the primary button sets it to `--accent-300`, as the blueprint card does. A second rule, `[data-marks] [data-marks]::before { content: none }`, makes "one marked level per stack" true everywhere, so the sign-in card's primary button is unmarked without the page saying so. The rule sits in a cascade layer so a utility still wins. Chosen over the card's four `<span>`s, which break `asChild` and add four nodes per object. Governs R2.
- KTD2. **The focus token draws its ink edge outside its pale ring, and one bridge rule makes it win.** In `tokens/semantic.css`, `--focus-ring` becomes a 2px `--accent-200` ring under a 1px `--accent-600` edge drawn at 3px, so the edge meets the page and the ring meets the control. On the page `#fcfcfd` the edge is about 6.6:1; on the primary fill the ring is about 4.3:1. The dark token gets the same order. In `tailwind-bridge.css` §5, one rule in the utilities layer gives `:focus-visible` on a focusable element `box-shadow: var(--focus-ring)` at a specificity above the kit's `focus-visible:ring-*` and `shadow-xs`, so every registry component installed now or later takes it with no edit to its file. Chosen over editing eight vendored files, which a future install would undo. Governs R5.
- KTD3. **`Card` is shadcn's `new-york-v4` `card` item, installed into `apps/web/src/shared/ui/card.tsx`.** Its arrival edits are listed in `THIRD_PARTY_NOTICES.md` with both digests:
  - no rounding and no shadow, a `--border-subtle` hairline, `bg-card`, padding on the parts rather than the root;
  - `CardHeader` keeps its title, description (the meta) and right-aligned `CardAction`;
  - `CardFooter` becomes the sunken strip for provenance, `--surface-sunken` under a hairline;
  - a `marks` prop sets `data-marks`;
  - `Card` and `CardTitle` take `asChild` as `Button` does, so a `<section aria-labelledby>` stays a region and a title keeps the caller's heading element.

  The parts are the header and body slots S2a's U12 asked for. Governs R1, R2.
- KTD4. **`Frame`, `GridPattern` and `DotPattern` are ours, in `apps/web/src/shared/blueprint.tsx`, drawn by stylesheet rules in the design system.** `Frame` is a transparent `div` with one hairline and `data-marks`, taking `asChild` as `Button` does. `GridPattern` and `DotPattern` wrap one element and draw their texture as its background. An absolutely placed layer, Magic UI's shape, needed an isolated, positioned page, and axe then read page controls as overlapping the sticky band. Their drawing reads `--grid-module`, `--grid-line`, `--dot-gap`, `--dot-radius` and `--dot-color` through `[data-grid-pattern]` and `[data-dot-pattern]` rules in `styles.css`, so no pitch or colour is a literal in TypeScript. Magic UI's SVG items take their pitch as numbers, and its dot item needs `motion`, so neither is installed; the readme's §7 already calls these ports retuned to the tokens. They sit outside `shared/ui/`, whose notices file covers registry source only. The shell's own `Frame` in `app/frame.tsx` keeps its name; no file draws both today, and one that does imports this one under an alias. Governs R1, R4.
- KTD5. **The substrate is drawn once per page, behind content, and the accessibility gate audits without it.** The shell's `main` and `AuthPage`'s outer wrapper each sit in one `GridPattern`. The shell's grid is offset by the pane's top padding, so content starts on a grid line without moving the page. Axe reads any background image under text as an undecided colour, so a page-wide substrate would move every text node's contrast to `incomplete` and leave the gate green while checking nothing. A mark's `::before` does the same to every text node inside a marked object: axe walks up from the text, meets a positioned pseudo-element with a background image, and reports `pseudoContent`. The gate in `apps/web/e2e/browser.ts` therefore, after counting drawn marks (KTD1), clears the background of `[data-grid-pattern]` and `[data-dot-pattern]` and hides `[data-marks]::before` for the audit. It then fails any `color-contrast` result left incomplete with axe's `bgImage`, `bgGradient` or `pseudoContent` key, so the gate cannot lose its contrast check again unnoticed. The substrate's lines are 5% black, and the gate's comment says what that costs body text. Governs R4, R5.
- KTD6. **The sign-in pages sit in a marked `Card` on the grid, not a `Frame`.** A `Frame` has no fill, and the transparent inputs would show grid lines through them. A card that is a direct child of the grid may carry marks under the readme's rationing. `AuthPage`'s title becomes the card's header and its children the body, centred at the prose measure. Its primary button is unmarked by KTD1's nesting rule. Governs R6.
- KTD7. **A row of secondary actions on a sign-in page takes the outline button.** It is the treatment the blueprint card pairs with the primary, and the one already used most in those rows. The `link` and `ghost` buttons in those rows, `KeystrokesAction` included, become `outline`. A link standing alone, such as *Sign in again* under a refusal, keeps the link treatment, since it is not in a row. Governs R6.
- KTD8. **Marks on the button follow the variant and the size.** `Button`'s `default` variant sets `data-marks` and `--mark-ink: var(--accent-300)` at the `default`, `sm` and `lg` sizes, all 32px or taller. The new `accent` variant is the same fill with no marks. The one committing action repeated per row today is the per-passkey rename's save, which moves to `accent`. Governs R2, R3.
- KTD9. **The open area in the rail takes the menu's open-page treatment.** `bg-[var(--surface-active)] text-foreground` with the bold glyph, as `app/menu.tsx` marks the open page. Governs R8.
- KTD10. **The refusal line is red words with no rule beside them.** The `alert` role and the sentence carry the meaning. Governs R7.

### Risks

| Risk | Mitigation |
|---|---|
| A mark protrudes 4px past its object, so an ancestor with `overflow: hidden` clips it | A card holding a scrolling table keeps the overflow on an inner wrapper. U3's harness reads a marked card's four marks unclipped |
| The bridge's focus rule reaches a control that draws its own ring on an inner part, such as `kibo-ui/counted-switch.tsx`, and draws two | U1 checks every component that names `--focus-ring` itself and excludes or adopts it |
| A page holds more than three primary buttons outside a marked parent | U2's gate counts marked objects on every page the suite leaves; a page over three is fixed by making its lesser actions `outline`, or the gate names it |
| Moving `main`'s top padding shifts every shell page by 8px | No spec measures it; the aria snapshots and keyboard traversals are unchanged |

### Assumptions

- The headless run took the scoping call-outs as decided: a marked card for the sign-in pages (KTD6), the outline treatment for secondary rows (KTD7), and `blueprint.tsx` as the home of `Frame` (KTD4).
- Port 3100 is shared with other sessions, so the browser suite runs locally under a copy of the config on another port. CI runs the committed config.

---

## Implementation Units

### U1. Bind the focus ring

- **Goal:** focus on every control is visible at 3:1 or more against its surroundings.
- **Requirements:** R5; KTD2.
- **Dependencies:** none.
- **Files:**
  - Modify: `packages/design-system/tokens/semantic.css`, `packages/design-system/tokens/tailwind-bridge.css`, `packages/design-system/readme.md` (Focus).
  - Create: `apps/web/e2e/focus-ring.spec.ts`.
  - Modify: `apps/web/e2e/locators.ts` (a contrast helper beside `tokenColour`), `.claude/skills/browser-suite/SKILL.md` (lists the helper).
- **Approach:**
  1. Reorder the token per KTD2, light and dark.
  2. Add the bridge's utilities-layer rule.
  3. Check every component that writes `--focus-ring` or `ring-` itself and settle it so one ring is drawn.
- **Patterns to follow:** `tokenColour` in `apps/web/e2e/locators.ts`; the sign-in spec's paint checks.
- **Test scenarios:**
  - Tabbing to the email field, the primary button and the outline button on `/sign-in`, each shows a ring whose outer edge is `--accent-600` at 3:1 or more against the page.
  - The primary button's focus ring meets 3:1 against the primary fill.
  - On a shell page, a select trigger, a checkbox, a tab and a menu link each draw the token's ring, and no kit ring.
  - Tabbing to a marked primary button (*Invite* on the Members page), the ring's edge along each side still measures 3:1 against the page where the marks overlap its corners.
- **Verification:** the spec passes, and an `agent-browser` screenshot of a focused primary and outline button is sampled at its ring pixels.

### U2. The mark, the primary button and the accent fill

- **Goal:** the primary button is the one solid marked object, and marks obey the rationing everywhere.
- **Requirements:** R2, R3; KTD1, KTD8.
- **Dependencies:** none.
- **Files:**
  - Modify: `packages/design-system/styles.css`, `apps/web/src/shared/ui/button.tsx`, `apps/web/src/shared/ui/THIRD_PARTY_NOTICES.md`, `apps/web/src/features/auth/passkeys-part.tsx`, `apps/web/e2e/browser.ts` (the count).
  - Modify: `packages/design-system/guidelines/blueprint-marks.card.html` (draws with the shared rule).
- **Approach:**
  1. Add the mark rule and the nesting rule (KTD1).
  2. Add `data-marks` to the `default` variant at its marked sizes and an `accent` variant (KTD8). Record the arrival edit and the new file digest.
  3. The gate counts marked objects whose marks are drawn, and fails a page with more than three.
- **Test scenarios:**
  - On the Members page, the primary *Invite* button's `::before` draws the four marks in `--accent-300`.
  - A primary button inside a marked card draws none.
  - An `xs` primary button draws none.
  - The per-passkey save is the accent fill with no marks.
  - A page with four marked objects fails the gate by name (the gate's own proof, as `accessibility-gate.spec.ts` proves the axe pass).
- **Verification:** every spec's final page has three or fewer drawn marks.

### U3. Card, Frame and the two textures

- **Goal:** the parts S2a builds on exist and draw as the readme says.
- **Requirements:** R1, R2, R4; KTD3, KTD4.
- **Dependencies:** U2 (the mark rule).
- **Files:**
  - Create: `apps/web/src/shared/ui/card.tsx`, `apps/web/src/shared/blueprint.tsx`, `apps/web/test/blueprint-parts.tsx`, `apps/web/e2e/blueprint-parts.spec.ts`.
  - Modify: `packages/design-system/styles.css` (the grid and dot rules), `apps/web/src/shared/ui/THIRD_PARTY_NOTICES.md`.
- **Approach:**
  1. Install `card` from the registry's source as the breadcrumb was, then apply KTD3's edits.
  2. Write `blueprint.tsx` per KTD4.
  3. Draw the parts in the browser through the list parts' Vite harness, sharing its bundling with `list-parts.spec.ts` rather than copying it.
- **Patterns to follow:** `apps/web/e2e/list-parts.spec.ts`; the `breadcrumb` entry in `THIRD_PARTY_NOTICES.md`.
- **Test scenarios:**
  - A `Frame` has no fill, a 1px hairline and four marks.
  - A `Card` without `marks` draws none; with `marks` it draws four.
  - A `Card`'s footer is the sunken surface under a hairline.
  - A `Card` inside a `Frame` draws no marks.
  - A `GridPattern` paints lines at the `--grid-module` pitch in `--grid-line`, and takes no pointer events.
  - A `DotPattern` paints dots at `--dot-gap` in `--dot-color`, and is hidden from assistive technology.
- **Verification:** the spec passes, and the parts pass the accessibility gate.

### U4. The substrate on every page, and the gate that audits around it

- **Goal:** every page stands on the grid, and the gate still checks text contrast.
- **Requirements:** R4, R5; KTD5.
- **Dependencies:** U3.
- **Files:**
  - Modify: `apps/web/src/app/frame.tsx`, `apps/web/src/features/auth/auth-page.tsx`, `apps/web/src/shared/ui/input.tsx` and `select.tsx` (the `bg-background` fill, so the grid does not run through a field), `apps/web/src/shared/ui/THIRD_PARTY_NOTICES.md`, `apps/web/e2e/browser.ts`, `apps/web/e2e/accessibility-gate.spec.ts`.
- **Execution note:** run the gate once with the substrate and no hiding, and record how many `color-contrast` results turned incomplete, before writing the hiding.
- **Test scenarios:**
  - A shell page and the sign-in page each hold exactly one `GridPattern`.
  - With the substrate and marks hidden for the audit, a page whose body text fails contrast still fails the gate.
  - On the sign-in page, the marked card's body text and a marked primary button's label each get a decided `color-contrast` result, not an incomplete one.
  - No `color-contrast` result on a page the suite leaves is incomplete with `bgImage`, `bgGradient` or `pseudoContent`.
- **Verification:** the whole browser suite passes the gate.

### U5. Pages draw cards with `Card`

- **Goal:** R1's "only way" holds across today's pages.
- **Requirements:** R1; KTD3.
- **Dependencies:** U3.
- **Files:**
  - Modify: `apps/web/src/app/pages/models-and-spend-page.tsx`, `apps/web/src/app/pages/unbuilt-page.tsx`, `apps/web/src/features/console/everyone-list.tsx`, `apps/web/src/features/console/names-waiting-list.tsx`, `apps/web/src/features/model-choices/model-choices-card.tsx`, `apps/web/src/features/people/audit-log-page.tsx`, `apps/web/src/features/people/groups-page.tsx`, `apps/web/src/features/people/invitations-tab.tsx`, `apps/web/src/features/people/members-tab.tsx`, `apps/web/src/features/people/waiting-list.tsx`, and the bordered sections in `member-sections.tsx`, `member-removal.tsx`, `member-activity.tsx`, `shared/sheet-part.tsx`, `features/auth/second-factor-pages.tsx` and `features/auth/ask-to-join.tsx`.
  - Modify: `apps/web/src/app/frame.tsx` (the skip link's fill), `apps/web/CODING_STANDARDS.md`.
  - Create: `apps/web/test/blueprint-in-one-place.test.ts`.
- **Approach:** each wrapper becomes `Card`, with a header where it has a heading and the content in the body. A sectioned wrapper keeps its element through `asChild`, and its heading through `CardTitle asChild`. The coding standard says a page draws a card with `Card`, a framed region with `Frame` and the substrate with `GridPattern`.
- **Test scenarios:**
  - No file under `apps/web/src` outside `shared/ui/card.tsx` writes `bg-card`.
  - No file outside `shared/blueprint.tsx`, `shared/ui/card.tsx` and `shared/ui/button.tsx` writes `data-marks`, `data-grid-pattern` or `data-dot-pattern`.
  - The existing aria snapshots of the migrated pages are unchanged.
- **Verification:** the scan passes, and the browser suite passes unchanged.

### U6. The sign-in pages, the refusal line and the rail

- **Goal:** the sign-in pages read as a framed form on the grid, and the shell's open area stops outweighing the primary button.
- **Requirements:** R6, R7, R8; KTD6, KTD7, KTD9, KTD10.
- **Dependencies:** U3, U4.
- **Files:**
  - Modify: `apps/web/src/features/auth/auth-page.tsx`, `apps/web/src/features/auth/sign-in-page.tsx`, `apps/web/src/features/auth/account-page.tsx`, `apps/web/src/shared/keystrokes.tsx` (`KeystrokesAction`), `apps/web/src/app/icon-rail.tsx`.
  - Modify: `apps/web/e2e/sign-in.spec.ts`, `apps/web/e2e/frame.spec.ts`.
- **Approach:** `AuthPage` per KTD6, its rows per KTD7, the refusal per KTD10, the rail per KTD9.
- **Test scenarios:**
  - The sign-in page's form sits in one marked card, centred, and its primary button draws no marks.
  - At 320px the sign-in page does not scroll sideways and the card's four marks are inside the viewport.
  - Every button in the code step's row of secondary actions is the outline treatment.
  - A refused code's alert has no left border.
  - The rail's open area fills with `--surface-active` and is not transparent, and its glyph is bold.
  - The sign-in, display-name and accept-invitation aria snapshots are unchanged.
- **Verification:** the sign-in, frame and second-factor specs pass, and the account page reads right centred, checked by eye.

### U7. The readme says what ships

- **Goal:** a reader of the design system learns where each part lives and how it is drawn.
- **Requirements:** R1 to R5.
- **Dependencies:** U1 to U6.
- **Files:** Modify: `packages/design-system/readme.md` (§4 marks, cards, textures and focus; §6 what is in the repository; §7 textures).
- **Approach:** through `ce-skill-work`, since the package is a tracked skill.
- **Test expectation:** none -- prose; `check:docs:api` scans it for the old glossary words.
- **Verification:** the readme names `data-marks`, `Card`, `Frame`, `GridPattern` and `DotPattern` where they live, and no claim in it contradicts the code.

---

## Verification Contract

- `pnpm --filter @better-answers/web run check`, with the browser suite run under a local copy of the config on a free port while 3100 is in use elsewhere.
- `pnpm run check:gates` at the root, and `pnpm --filter @better-answers/api run check:docs` (the words gate over `docs/`).
- An `agent-browser` measurement of the focus ring's ring and edge pixels against the page and the primary fill, recorded in the pull request's report.

## Definition of Done

- R1 to R8 hold, each proved by a scenario above.
- Every vendored file this change edits has its arrival edit and new digest in `THIRD_PARTY_NOTICES.md`.
- No abandoned attempt, local Playwright config or probe is left in the diff.
