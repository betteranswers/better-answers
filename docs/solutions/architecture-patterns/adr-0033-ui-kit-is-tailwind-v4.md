---
title: "The interface is Tailwind v4 on the tokens; the registries own behaviour, the platform meaning"
date: 2026-09-05
module: apps/web
problem_type: architecture_pattern
component: web
severity: medium
applies_when:
  - "Building or styling a page in apps/web"
  - "Adding a component from shadcn, Kibo UI or AI Elements"
  - "Reaching for a component library or another UI dependency"
  - "Changing the sign-in, workspace picker or refused pages"
tags:
  - adr-0033
  - tailwind
  - shadcn
  - kibo-ui
  - ai-elements
  - design-tokens
  - shared-ui
---

# The interface is Tailwind v4 on the tokens; the registries own behaviour, the platform meaning

## The decision

The interface is Tailwind v4. Its theme is the design system's tokens, read through one bridge stylesheet, `packages/design-system/tokens/tailwind-bridge.css`. There is no `tailwind.config.js`.

- In a page, a colour, a size or a radius that is not a theme value from the tokens is a defect. The bridge is the one place a literal may stand, and only where a token cannot reach. A page reads a type step as `var(--text-lg)`, because the design system owns the `--text-*` names.
- Components come from three shadcn registries: shadcn for the primitives, Kibo UI for the composed pieces, and Vercel AI Elements for answers. They arrive as source in this repository, and each is reviewed before it lands.
- The registries own behaviour: keyboard handling, focus, ARIA wiring, virtualisation and streaming. The platform owns meaning: the trust words, the citation unit, the register and the glossary's vocabulary. Where the two meet, we take their component, skin it, and keep the meaning in ours.
- The web's wording follows Kibo UI's patterns: their strings where one fits the product, their casing for each kind of text, and sentences written in the same manner where Kibo has none. In that wording the trust words and the glossary's words stay the platform's own. `packages/design-system/readme.md` holds the rule and its examples.
- The design system's own components are deleted. Its tokens, stylesheet and bridge stay.
- The components live in `apps/web/src/shared/ui/`, with `kibo-ui/` and `ai-elements/` beside the shadcn primitives. `apps/web/components.json` records the registries and aliases.
- `.oxlintrc.json` turns off four rules that judge how a component is written, over `apps/web/src/shared/ui/**` alone. Every import rule, the accessibility rule at the page and the anti-slop rules stay on.
- Kibo UI's `table` is rejected, because it is written against `@tanstack/react-table` v8. The shadcn `table` primitive stands in.
- better-auth-ui is not used. The auth module's own TanStack Query factories replace better-auth-ui's provider, its `localization` and its hooks. They sit over the `better-auth` client, in `apps/web/src/features/auth/auth-hooks.ts`. The module's words files, `sign-in-words.ts` and `workspace-words.ts` among them, hold the words its pages show. The package and its two `declare module` augmentations are gone.
- better-auth-ui's 28 rendered sign-in files stay refused. They are sign-up, password and social pages for a product this platform does not have.
- `apps/web` stays on `moduleResolution: "bundler"` on the SPA's own grounds: Vite builds it and nothing in it is emitted.

## Why

- A second component set is drift by construction. A page that reaches for whatever component it needs ends up with four button styles.
- v4's CSS-first theme removes the second copy of the tokens a config file would hold.
- The registries the product wants are Tailwind-shaped, AI Elements above all.
- ADR 0019 makes trust a derived thing said in fixed words. A library that shipped its own severity palette would quietly contradict it.
- Taking Kibo's `table` would have pinned a knowingly superseded major version.
- better-auth-ui cost more than its roughly 70 library-facing lines: near-daily releases, broken declaration emit, peer warnings for packages this product will never use, and a second library for a reviewer to read. Every sentence of the sign-in is a platform decision, so little behaviour was left for the library to own.

## Rejected

- The design system's own `.jsx` components: a second set the application did not import.
- Tailwind v3 with a config file: a second copy of the tokens, kept in sync by hand.
- CSS Modules or vanilla-extract with no Tailwind: the registries are Tailwind-shaped, and re-styling them costs more.
- MUI, Mantine or Chakra: each owns meaning as well as behaviour.
- Headless primitives alone, Radix or Base UI: the registries add composed pieces at no coupling cost.
- better-auth-ui's provider, `localization` and headless hooks: taken on 03/09/2026 and reversed two days later.

## History

The full record, with its three amendments (T-036, T-037, T-046): `docs/archive/adr/0033-ui-kit-is-tailwind-v4.md`.

Amended 13/10/2026 by the web wording plan (`docs/plans/2026-10-13-1101-fix-web-wording-and-stock-refusals-plan.md`, R5 and R7). The platform's meaning took in the wording of each page, written to its own rules. The web's wording now follows Kibo UI's patterns, and the platform keeps the trust words and the glossary's words. The registries still own behaviour, and no component's source changes by this.
