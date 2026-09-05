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
file: the theme *is* CSS, and the CSS is the design system's. **In a screen, a colour, a size or a radius that is not a
theme value from the tokens is a defect**, not a preference. The bridge itself is the one
place literals are allowed, and only where a token cannot reach: it fills a few kit contract
names — a destructive foreground, the dark theme's handful of overrides — with raw values,
because a kit may wrap them in `color-mix()` or an opacity modifier, which needs a real
colour rather than a `var()` chain. The file says so where it does it. The second exception
is the type scale, because Tailwind's font-size namespace is `--text-*`
and the design system already owns those names, so a screen reads a type step as
`var(--text-lg)` and the bridge says why in the file.

**Components come from three shadcn registries plus better-auth-ui, and none of them is
vendored blindly.** `shadcn` for the primitives (dialog, select, table, tabs), **Kibo UI**
for the composed pieces built on them, **Vercel AI Elements** for the answer surface —
streaming, reasoning, citations-in-flight — and **better-auth-ui** for the sign-in and
workspace-picker screens, over the Better Auth instance in `apps/api` that mints the
session — the library draws those screens, it does not issue anything. All four arrive as
*source into this repository*, which is what a shadcn registry is: there will be no
runtime dependency to be broken by an upstream release, and a component that has to be
re-skinned is edited in place. **None of them is installed by this ADR's own PR** — that is
the next ticket's; what is settled here is which registries, and under which rule.

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

Versions are read from the source on the day (`[DEPS1]`), never from memory. The source for
each of these is the **npm registry**, read with `npm view <package> version` on **2
September 2026**, and each pin lives in the manifest of the workspace that owns it. The pins
taken that day are `tailwindcss` and `@tailwindcss/vite` 4.3.3,
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

## Amendment — 2026-09-03, the registry components land, and what they cost (T-036)

The ADR left the registry components to "a later ticket… pinned when they are". This is that
pin. Everything below was read from the registry on **3 September 2026**; nothing came from
memory (`[DEPS1]`).

**Where they live.** `apps/web/src/shared/ui/` holds the shadcn primitives — `badge`,
`button`, `carousel`, `collapsible`, `command`, `dialog`, `dropdown-menu`, `hover-card`,
`popover`, `select`, `table`, `tabs` — with `kibo-ui/` and `ai-elements/` beside them so a
reader can tell at a glance which registry a component came from. `shared/lib/utils.ts` holds
the `cn` helper all three expect. `apps/web/components.json` records the two registry URLs
(`https://www.kibo-ui.com/r/{name}.json`, `https://registry.ai-sdk.dev/{name}.json`) and the
aliases, so the next install lands in the same places.

**What was taken.** shadcn's primitives above; Kibo UI's `combobox` and `snippet`; AI
Elements' `sources` and `inline-citation`. The CLIs are `shadcn@4.20.1` and
`ai-elements@1.9.0`; a shadcn registry item carries no version of its own, so the pin is the
CLI version, the registry URL and the date, and the source itself is in this repository.

**Kibo UI's `table` was read and rejected**, which is what "reviewed before it lands" is for:
its source is written against `@tanstack/react-table` v8, and v9 — current on the day — is a
breaking rewrite (`useReactTable` and `getCoreRowModel` no longer exist). Taking it would have
meant pinning a knowingly-superseded major on the day the repository first depends on it. The
review table it was wanted for uses the shadcn `table` primitive until Kibo catches up.

**Three costs the ADR did not name, now visible.**

1. **Registry source does not pass rules written for our own code.** Four rules are turned off
   over `apps/web/src/shared/ui/**` in `.oxlintrc.json` — `react/set-state-in-effect`,
   `react-doctor/effect-needs-cleanup`, `jsx-a11y/prefer-tag-over-role` and the type-assertion
   safety comment — each of which judges *how* a component is written, which is the half this
   ADR gives the registries. Every import rule, `no-console`, `[A11Y1]` at the screen and the
   anti-slop rules that catch a widened type stay on.
2. **The registries write extensionless imports**, which do not resolve under this repository's
   `nodenext` setting. They are rewritten to explicit `.ts`/`.tsx` on arrival, along with the
   `"use client"` directives, which mean nothing in a Vite SPA.
3. **The icons are lucide-react**, because that is what the primitives import. The design
   system's Phosphor choice stands for the platform's own components; a chevron inside a
   `Select` is behaviour, not meaning.

## Amendment — 2026-09-03, what better-auth-ui gives this product, and what it does not (T-037)

This ADR names better-auth-ui "for the sign-in and workspace screens" and takes it as one of
the four registries. The sign-in ticket has now read the registry, and the decision is
sharpened rather than reversed: **what is taken is the provider, the localization and the
headless hooks. The rendered screens are not taken.**

**What is taken.** The `auth-provider` item through the shadcn registry — the wrapper over the
npm primitive, the `Link` slot that lets a library component render an internal link without
knowing the router, and the plugin type beside it — pinned as every registry item is, by the
CLI, the URL and the date (`apps/web/src/shared/ui/THIRD_PARTY_NOTICES.md`). Under it, the npm
packages `@better-auth-ui/core` and `@better-auth-ui/react` at **1.7.19**, read from the
registry on the day and pinned exactly: TanStack Query option factories and the React hooks
over them — the email code, the workspaces a person holds, the pick, and the resume of an
authorization the product interrupted. And the `localization`, which is the whole reason this
library is named in this ADR at all: `organization` becomes *Workspace*, and the four keys a
screen in v0.1 renders are stated in one file the screens read through `useAuth()`, so a
screen cannot quietly say a fifth.

**What is not taken, and why.** The registry's `auth` and `email-otp` items copy **28 files**
into the tree, among them sign-up, forgot-password, reset-password, verify-email, a password
strength meter, social provider buttons and change-email. This product has no password, no
sign-up and no social provider: a person exists because an Admin added them to a workspace
(ADR 0009). Those files would sit in the tree, be linted, be reviewed, and imply a product
that does not exist — which is exactly the argument `docs/research/t-022-better-auth-ui.md`
made against the `organization` item's 53 files, applied to the same library's other end. They
also bring `@tanstack/react-form`, `date-fns`, `input-otp` and about sixteen further shadcn
primitives for one screen.

So the three screens outside the shell — sign-in, the picker and the refused screen — are
written by the platform on the library's hooks, with `input` and `label` from shadcn under
them. The rule this ADR states is unchanged and is what makes the split legible: **the library
owns behaviour, the platform owns meaning.** For a sign-in whose every visible sentence is a
platform decision — what a sent code says, what a refused code says, what too many codes says —
there is very little behaviour left to own, and the hooks are exactly that little. The
`error-toaster.tsx` of the provider item is not taken either, for the same reason at a smaller
scale: this product's screens say what happened inline, in a live region beside the control
that caused it, and a toast would be a second announcement of the same sentence — with two
dependencies behind it.

**One consequence for the whole workspace.** `@better-auth-ui/react@1.7.19` ships declaration
files whose re-exports are extensionless, which `nodenext` will not resolve — every export of
the package then reads as missing. `apps/web` therefore resolves as what builds it does:
`module: "preserve"`, `moduleResolution: "bundler"`. This is cost 2 of the 2026-09-03
amendment above, arriving at a size a rewrite-on-arrival cannot fix, because these files are a
dependency rather than source. `apps/api` is unchanged and stays on `nodenext`; nothing in
`apps/web` is emitted by `tsc`.

## Amendment — 2026-09-05, better-auth-ui leaves; the auth module's own hooks over the client (T-046, landed by T-051)

The amendment above took three things from better-auth-ui: the provider, the `localization`
and the headless hooks. **That is reversed.** On 2026-09-05 all three are replaced by the
platform's own, and `@better-auth-ui/core` and `@better-auth-ui/react` leave the workspace.
The registries this ADR names are now three.

**What replaced them.** The auth module's `auth-hooks.ts` — seven TanStack Query
`queryOptions`/`mutationOptions` factories over the `better-auth` client the module already
constructs, keeping the hook names the screens call (the session, sign-out, the email code
and its verification, the workspaces a person holds, the pick, and the OAuth resume), in a
query-key space the module owns, each mutation throwing the client's error object unchanged
so the screens' status checks read what they read before. The `localization` is the module's
own plain word map, `workspace-words.ts`, read directly by the screens that render its words.
The provider is deleted rather than shimmed: the hooks close over the module's client and
the app's one query cache, so there was nothing left to provide and the router root mounts
its outlet directly. The `auth-provider` registry item — the provider wrapper and the
plugin-type file, with their two `declare module` augmentations of a library outside the
auth module — is removed with it, so no augmentation of a deleted library survives anywhere
in the tree and `[DESIGN5]`'s browser half needs no exemption sentence.

**Why.** Four costs for about 70 library-facing lines among the feature's 750 (the count
and the decision are in `apps/docs-site/specs/T-046.md`). The package shipped 66 releases
between 15 April and the pin, 12 of them in the 12 days before it, so Renovate proposed an
update most days. Its declaration emit was broken — the extensionless re-exports recorded in
the consequence above, filed upstream by T-042 as
[better-auth-ui/better-auth-ui#562](https://github.com/better-auth-ui/better-auth-ui/issues/562).
Its peer list demanded react-email, passkey and api-key packages this product will never
use, so every install printed warnings a reader had to learn to ignore. And it was a second
library surface: a reviewer of the auth feature had to know the hooks' contracts as well as
the client's own, when the client already exposes everything the hooks wrapped and TanStack
Query was already the SPA's data layer (T-036). The cost was about to compound — T-027's
People screens built on the library would have grown the surface from nine imported names
to about fifteen.

**What stands.** The rule — the library owns behaviour, the platform owns meaning — is
unchanged; what this reversal records is that for a sign-in whose every visible sentence is
a platform decision, the behaviour left to own was too little to be worth a dependency. The
three screens outside the shell are unchanged to the person at them, proved by the browser
suite staying green without an edit. shadcn's `input` and `label`, taken the same day as
the provider, stay: the sign-in screen renders them. `apps/web` stays on `module:
"preserve"` and `moduleResolution: "bundler"` on the app's own grounds — Vite builds it and
nothing in it is emitted — so the consequence recorded above outlives its trigger, and
`nodenext` is not reopened.
