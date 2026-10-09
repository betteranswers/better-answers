---
title: The Web App's Design-System Wiring Before the Critique - Plan
type: fix
date: 2026-10-09
topic: web-design-system-wiring
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# The Web App's Design-System Wiring Before the Critique - Plan

## Goal Capsule

- **Objective:** When BA-36's design critique scores a screen, it is scoring the design, and not three faults in how the app is wired to the design system. A machine in dark mode renders the same page as one in light mode. Kit borders draw as hairlines rather than in the text colour. The primary button is the accent fill that the design system's readme specifies.
- **Means:** bind `dark:` to the theme selector, give every border the design system's border token as its default colour, and point the primary control tokens at the accent, and keep non-interactive fills near-black (KTD1 to KTD4).
- **Authority:** the owner's three decisions (KTD1 to KTD3), then `packages/design-system/readme.md`, then the units.
- **Stop conditions:** no foreground token gives the accent 4.5:1. Or the fix would need a pattern that does not exist yet (registration marks, Frame, Card, grid substrate).
- **Execution profile:** one pull request, `Related to BA-36`, `Merge risk: reversible`. The merge is not armed.
- **Who finishes:** `ce-work` builds it, `ce-code-review` reviews it, and `ce-commit-push-pr` opens the pull request.

---

## Product Contract

### Summary

`apps/web/src/index.css` gains a `dark` custom variant on the theme selector and a base-layer default border colour. The semantic `--control-primary-*` tokens alias the accent controls, so shadcn's `primary` renders ink blue with white text. Docs that call the primary button near-black now say it is the accent fill. Non-interactive surfaces that used `primary` for a near-black fill keep near-black.

### Problem Frame

The investigation of 09/10/2026 (`.scratch/research/ui-design-system-conformance-2026-10-09.md`, git-ignored) found that the token pipeline works end to end, with two wiring faults and one contradiction in the design system:

- With no `@custom-variant dark`, Tailwind v4 compiles the kit's 29 `dark:` utilities under `prefers-color-scheme: dark`. The tokens flip only on `[data-theme="dark"]` or `.dark`, and nothing sets either, so on a dark-mode machine the input and the outline button take grey fills over a light page.
- Preflight leaves `border-color` at `currentColor`, and nothing overrides it. The outline button, dialogs, menus, popovers, sheets and table rules draw borders in `rgb(38,41,46)`, the body text colour. Some pages patched this with a bare `border-border`.
- `readme.md` says the primary button is "an accent fill". `tailwind-bridge.css`, `semantic.css` and `kits-adoption.card.html` say near-black. The owner ruled that the readme is right.

### Requirements

- R1. With the OS in dark mode, `/sign-in` renders the same as with the OS in light mode.
- R2. A border with no colour class draws in `--border` (`--border-subtle`). A control's edge, the outline button included, draws in `--border-default`.
- R3. A bare `border-border` that only restated the missing default is removed. A colour that means something else stays.
- R4. The primary button fills with `--accent-600` (`#2e4bd4`), and its text meets WCAG AA at 4.5:1 or more.
- R5. No design-system doc, token comment or card still says the primary button is near-black.
- R6. A surface that is not interactive and that used `primary` for a near-black fill keeps near-black, per the readme's rule that ink blue is interactive only.

### Scope Boundaries

- No registration marks, `Frame`, `Card`, grid substrate or textures.
- No dark theme toggle. Nothing sets `data-theme` yet.
- No `html { background }` and no change to the focus ring treatment. The investigation lists both, but neither is one of the owner's three decisions.
- `border border-border` and `divide-y divide-border` pairs stay. They restate the default too, but removing them across about 50 sites is churn, not a fix.
- The vendored `badge.tsx:17` and `item.tsx:24` outline variants keep their `border-border`.
- No unit edits `AvatarBadge` or the badge's `default` variant. They inherit the accent through `primary`, and no page uses either, so their colour can be settled if a page ever does.
- Until registration marks exist, the marked `primary` button and the unmarked `accent` fill that the readme gives an action repeated per row look the same. The critique can record that.
- The coloured left border on the sign-in error (`features/auth/auth-page.tsx`) stays for the critique to record.
- No decision doc changes: ADR 0033 (`docs/solutions/architecture-patterns/adr-0033-ui-kit-is-tailwind-v4.md`) states neither the primary colour nor a border default.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **`dark:` is a custom variant on `[data-theme="dark"]` and its descendants** (session-settled: user-directed — chosen over Tailwind v4's default `prefers-color-scheme` variant: the tokens flip only on the theme selector, so an OS-driven variant fires over a light theme). The readme says the dark theme is "a full alias flip on `[data-theme=\"dark\"]`", and `semantic.css` flips only there. The bridge also re-points its shadcn names on `.dark`, but a `.dark` class alone would leave the semantic tokens light, so binding `dark:` to it would bring back the mismatch this fixes. It sits in `index.css` after the `tailwindcss` import, beside the app's other Tailwind configuration. Governs R1.
- KTD2. **A base-layer rule gives `*`, `::before` and `::after` `border-color: var(--border)`** (session-settled: user-directed — chosen over preflight's `currentColor`: kit borders drew in the text colour). It goes in `index.css`'s `@layer base` after the `tailwindcss` import, so in the same layer it comes later than preflight and wins. `--border` is `--border-subtle`, the readme's "internal divisions". The outline button variant adds `border-input` (`--border-default`), because the readme puts `--border-default` on control edges. The input, checkbox and radio already carry `border-input`. Governs R2, R3.
- KTD3. **The primary button is the accent fill, and the semantic `--control-primary-*` tokens alias the accent controls** (session-settled: user-directed — chosen over a near-black primary: the owner ruled that `readme.md`'s accent fill is right). In `semantic.css`, `--control-primary-bg` and `--control-primary-bg-hover` alias `--control-accent-bg` and `--control-accent-bg-hover`. `--control-primary-bg-active` is `--accent-800`. `--control-primary-fg` aliases `--text-on-accent`. The dark block sets the rest state to `--control-accent-bg` (`--accent-500`), hover to `--accent-600`, active to `--accent-700`, and the foreground to `--text-on-accent`, so white text passes on every state. It does not alias the dark `--control-accent-bg-hover`, `--accent-400`, where white text is about 3.4:1. The kit's button reads only the rest state (`hover:bg-primary/90`), so the state tokens are kept true rather than wired in. The bridge's `--primary: var(--control-primary-bg)` mapping then needs no change, and its comments are rewritten. This was chosen over repointing only the bridge, which would have left `--control-primary-*` defined near-black with nothing reading it. Measured: `#ffffff` on `#2e4bd4` is 6.83:1 (light). In dark, `#ffffff` on `--accent-500` `#3f62ea` is 5.06:1. The dark block's old `--control-primary-fg` `#0b0c0e` on `--accent-500` would be 3.86:1, so the aliases replace it. Governs R4, R5.
- KTD4. **A non-interactive near-black fill moves off `primary` onto the foreground pair.** The icon rail's open area (`app/icon-rail.tsx`), whose comment says greyscale tells it apart, becomes `bg-foreground text-background`. The upload progress bar (`shared/ui/progress.tsx`) becomes `bg-foreground` with a `bg-foreground/20` track. The checkbox, the radio, input selection and the `link` variants are interactive, so they take the accent. The `link` variant moving to ink blue also makes the app's two link colours one. Governs R6.

### Risks

| Risk | Mitigation |
|---|---|
| The default border rule reaches an element that relied on `currentColor` on purpose, such as a spinner drawn with `border-current` | Explicit colour utilities still win over the base layer. The accessibility gate's spinner sets `currentColor` inline. A search for `border-current` and `border-[currentColor]` before the change confirms nothing else depends on it |
| Ink blue now appears on more controls: the checkbox, the radio and the link buttons | Each is interactive, which the readme allows. The critique scores the rest |

### Assumptions

- Nothing in `apps/web` sets `data-theme` or `.dark`, so the dark theme stays off. The variant only stops the OS from switching it on.

---

## Implementation Units

### U1. Bind `dark:` to the theme and give borders their default

- **Goal:** OS dark mode changes nothing on a light page, and an uncoloured border draws in the border token.
- **Requirements:** R1, R2, R3; KTD1, KTD2.
- **Dependencies:** none.
- **Files:**
  - `apps/web/src/index.css`: the custom variant and the base-layer border rule, each with a short comment saying why.
  - `apps/web/src/shared/ui/button.tsx`: `border-input` on the `outline` variant.
  - Every bare `border-border` that step 1's search returns. The known ones are `apps/web/src/app/band.tsx`'s `BandOutcome`, `apps/web/src/features/people/waiting-list.tsx`'s two `TableRow`s, and `apps/web/src/shared/grid-table.tsx`'s three `TableRow`s.
  - `apps/web/e2e/sign-in.spec.ts`: the browser checks below.
- **Approach:**
  1. Search for a bare `border-border` with no width utility on the same element, and for any reliance on `currentColor` borders. Remove the first. Report the second if it exists.
  2. Add the variant and the base rule to `index.css`.
  3. Add `border-input` to the outline variant. The kit's `dark:border-input` stays.
- **Patterns to follow:** the existing `@layer base` blocks in `index.css`, and `people.spec.ts`'s `toHaveCSS` checks on the kit's computed styles.
- **Execution note:** prove it in the browser. Follow the `browser-suite` skill for the spec.
- **Test scenarios:**
  - On `/sign-in` with the colour scheme emulated as dark, the email input's background and the passkey outline button's background and border colour equal their values under the light scheme.
  - On `/sign-in`, the passkey outline button's border colour is `--border-default`, `rgb(223, 225, 230)`.
- **Verification:** the built CSS has no `prefers-color-scheme` block, and the web `check` passes.

### U2. The primary button takes the accent fill

- **Goal:** the primary button is ink blue with white text, and the design system says so everywhere.
- **Requirements:** R4, R5, R6; KTD3, KTD4.
- **Dependencies:** none.
- **Files:**
  - `packages/design-system/tokens/semantic.css`: the `--control-primary-*` aliases, light and dark.
  - `packages/design-system/tokens/tailwind-bridge.css`: header note 2 and the `:root` comment on `--primary`.
  - `packages/design-system/guidelines/kits-adoption.card.html`: the "Two words that mean the opposite" note.
  - `packages/design-system/readme.md` and `packages/design-system/guidelines/colors-accent.card.html`: ink blue's uses name both accent-filled buttons, the primary button and the unmarked accent fill on an action repeated per row, in place of "the accent button at a gate".
  - `apps/web/src/app/icon-rail.tsx`, `apps/web/src/shared/ui/progress.tsx`: KTD4's foreground pair.
  - `apps/web/e2e/sign-in.spec.ts` and `apps/web/e2e/frame.spec.ts`: the browser checks below.
- **Approach:**
  1. Invoke the repo-local `ce-skill-work` skill before editing anything under `packages/design-system/`. It is the tracked `better-answers-design` skill.
  2. Alias the semantic tokens (KTD3), and rewrite the bridge and card wording so that `primary` is the accent fill and `brand` is the name no kit overwrites.
  3. Move the icon rail's open state and the progress bar to the foreground pair (KTD4), keeping the icon rail's comment true.
  4. Search the design system and `apps/web` once more for "near-black" said of the button.
- **Patterns to follow:** the bridge's existing comment voice, and `semantic.css`'s alias-only rule ("Components reference only these, never the base ramp").
- **Test scenarios:**
  - On `/sign-in`, the email step's primary button (`SIGN_IN_WORDS.send`) has background `rgb(46, 75, 212)` and text `rgb(255, 255, 255)`.
  - In the shell, the icon rail's open area has the `--foreground` background, not the accent.
  - The accessibility gate passes on `/sign-in`, so axe finds the new pair's contrast acceptable.
- **Verification:** the web `check` and `check:gates` pass, and `ce-skill-work`'s validation passes for the design-system edits.

---

## Verification Contract

| Check | Proves | Applies to |
|---|---|---|
| `pnpm --filter @better-answers/web run check` (typecheck, unit tests, the Playwright suite with the accessibility gate) | R1, R2, R4, R6, and that axe accepts the new contrast | U1, U2 |
| The built CSS has no `prefers-color-scheme` block | R1 at the bundle | U1 |
| `pnpm check:gates` | lint and the repository gates over the edits | U1, U2 |
| `pnpm check:docs` | the readme's formatting | U2 |
| `ce-skill-work`'s validation | the design-system skill edits | U2 |

---

## Definition of Done

- OS dark and OS light render `/sign-in` the same.
- The outline button's border is `--border-default`, and uncoloured kit borders are `--border-subtle`.
- The primary button is `#2e4bd4` with white text at 6.83:1.
- No design-system file calls the primary button near-black.
- The icon rail's open area and the progress bar stay near-black.
- No abandoned edits are left in the diff.

---

## Appendix

### Sources

- `.scratch/research/ui-design-system-conformance-2026-10-09.md` (git-ignored, in the main checkout): the investigation, with file and line evidence and the measured values.
- `packages/design-system/readme.md` §4 *Visual foundations*: the register, colour and borders.
- Linear BA-36: the design critique this prepares for.
