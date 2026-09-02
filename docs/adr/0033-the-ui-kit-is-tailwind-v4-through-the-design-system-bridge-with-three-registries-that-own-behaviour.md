---
status: accepted
date: 2026-09-02
---

# The interface is Tailwind v4 through the design system's bridge, with three shadcn registries and better-auth-ui that own behaviour while the platform owns meaning

`apps/web` had three files and a heading. This ADR records what it is built out of, because
the choice binds every screen after the first and because the alternative — each screen
reaching for whatever component it needs — is how a product ends up with four button
styles and two vocabularies for the same idea.

**Tailwind v4, and its theme is the design system's tokens read through one bridge
stylesheet.** `packages/design-system` already held the tokens, the stylesheet and
`tokens/tailwind-bridge.css`, a file written to map the shadcn variable contract onto
Better Answers tokens. The SPA imports that bridge, so `bg-card` is `--surface-card`,
`text-brand` is the ink blue, `p-4` is `--space-4` and every step of the radius ramp is 0.
There is no `tailwind.config.js` to drift from the tokens, because v4 has no configuration
file: the theme *is* CSS, and the CSS is the design system's. **A colour, a size or a radius
that is not a theme value from the tokens is a defect**, not a preference — the one
deliberate exception is the type scale, because Tailwind's font-size namespace is `--text-*`
and the design system already owns those names, so a screen reads a type step as
`var(--text-lg)` and the bridge says why in the file.

**Components come from three shadcn registries plus better-auth-ui, and none of them is
vendored blindly.** `shadcn` for the primitives (dialog, select, table, tabs), **Kibo UI**
for the composed pieces built on them, **Vercel AI Elements** for the answer surface —
streaming, reasoning, citations-in-flight — and **better-auth-ui** for the sign-in and
workspace-picker screens, which is the same library that mints the session. All four are
installed as *source into this repository*, which is what a shadcn registry is: there is no
runtime dependency to be broken by an upstream release, and a component that has to be
re-skinned is edited in place.

**One rule governs all four: they own behaviour, the platform owns meaning.** Keyboard
handling, focus management, ARIA wiring, virtualisation, streaming and the fiddly parts of
a combobox are theirs, and we take them as given rather than reimplementing them badly. The
trust words, the citation unit, the register (square corners, hairlines, registration
marks), the glossary's vocabulary and every sentence a reader sees are ours, and no
registry gets to supply them. Where the two meet — a `Badge` that could hold a trust word —
we take theirs and skin it, and the meaning stays in our component. This is the rule that
keeps `TrustTag` from becoming "a badge with a colour": ADR 0019 makes trust a derived
thing said in fixed words, and a component library that shipped its own severity palette
would quietly contradict it.

**better-auth-ui is named here rather than left to the sign-in ticket** because it is the
one registry whose vocabulary actively disagrees with ours: it says *organization*
throughout, and `CONTEXT.md` says *workspace* and marks *organisation* as a word to avoid.
It is taken with a `localization` override that replaces every one of those strings, and
that override is not optional — a screen that says "organization" is a defect against
`[GLOSSARY1]`, not a cosmetic issue.

Versions are read from the registry on the day (`[DEPS1]`), never from memory. The pins
taken on 2 September 2026 are `tailwindcss` and `@tailwindcss/vite` 4.3.3,
`@tanstack/react-router` 1.170.32, `@playwright/test` 1.62.1 and
`@fontsource-variable/geist` / `-geist-mono` 5.3.0; the registry components themselves are
installed by a later ticket and pinned when they are.

## Considered options

- **The design system's own `.jsx` components.** `packages/design-system` shipped a full
  set — `Button`, `Card`, `Dialog`, `DataTable`, `SideNav` and two dozen more — authored
  before any application existed, styled through the CSS custom properties, with a
  click-through `ui_kits/platform/` recreation of the product beside them. Rejected, and
  **deleted in the same PR as this ADR**: they are a second component set that the
  application does not import, and a second set is drift by construction. What they were
  for — proving the register could be built — they have already done, and the guidelines
  cards keep the record of it. The tokens, the stylesheet and the bridge stay, which is the
  part an application actually consumes.
- **Tailwind v3 with a config file.** Rejected: a `tailwind.config.js` theme is a second
  copy of the tokens, kept in sync by hand. v4's CSS-first theme removes the copy.
- **CSS Modules or vanilla-extract over the tokens, no Tailwind.** Defensible, and it would
  keep the design system's own components viable. Rejected because the registries the
  product wants — AI Elements above all, which is the answer surface and would otherwise be
  hand-built — are Tailwind-shaped, and re-styling them would cost more than the utility
  classes save.
- **A component library with its own design language (MUI, Mantine, Chakra).** Rejected:
  every one of them owns meaning as well as behaviour — its own severity colours, its own
  empty-state voice, its own idea of what a badge is for — and unpicking that is more work
  than assembling primitives.
- **Headless primitives alone (Radix or Base UI, no registry).** The honest minimum, and
  what shadcn is built on. Rejected only because the registries add the composed pieces at
  no coupling cost: the output is source in this repository either way.

## Consequences

- **`packages/design-system` is a workspace package** with a `package.json`, and it wires
  the two self-hosted faces (`@fontsource-variable/geist`, `-geist-mono`) so the product
  makes no third-party font request. Its `styles.css` imports its token files by explicitly
  relative path in the plain-string form, because a bundler reads `tokens/colors.css` as a
  package name and Tailwind v4's import resolver does not follow the `url()` form — the
  failure mode is silent: every utility present and no token values behind them.
- **The SPA's stylesheet imports the tokens before Tailwind**, because a nested `@import`
  may follow only another `@import` and would otherwise be dropped without a word.
- **`apps/web` gains a browser suite** and `[TEST1]` gains its line: the served build driven
  by a browser, or a rendered component through Testing Library where a component's
  behaviour is the thing under test.
- **A registry component is reviewed before it lands**, like any lifted part (ADR 0005): it
  arrives as source, so it is read, and its `THIRD_PARTY_NOTICES` obligation is the same as
  every other lift's.
- **This ADR is calibrated against one screen.** The frame exists; the answer surface, where
  AI Elements earns its place, does not. If the streaming components turn out to fight the
  register, that is an amendment here rather than a quiet substitution.
