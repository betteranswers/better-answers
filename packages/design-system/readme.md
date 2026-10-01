# better-answers — design system

A living company knowledge map for UK SMBs, built on OKF v0.2. Every answer cited,
permission-aware and explainable. This repository is the brand and interface system for
the hosted product at `better-answers.com`.

---

## 1. Where this came from

| Source | Path / link | What was taken from it |
| --- | --- | --- |
| The better-answers repository (mounted, read-only) | `better-answers/` | Product definition, glossary, UX and accessibility rules, the reader-facing word set, Control Centre's screens |
| `VISION.md` | in that repo | The one-line positioning, the three knowledge layers, who uses it |
| `CONTEXT.md` | in that repo | The **domain glossary** — the names the code uses, which a screen borrows only where they are the reader's words too |
| `CODING_STANDARDS.md` | in that repo | disclosure model, latency and keyboard budget, WCAG 2.2 AA + GOV.UK semantics |
| `docs/archive/adr/0001–0027` | in that repo | Answer contract (0016), citation markers (0015), the write path (0012), trust derivation (0019), open-core (0027) |
| Styling brief (from the user) | — | "better-auth, Vercel, Linear" — the visual register |

**When this system was authored, the repository held no interface code.** It was
pre-build: `app/`, `web/` and `worker/` were described in `AGENTS.md` but did not exist on
disk, and there were no components, stylesheets, fonts, icons or logo files anywhere in
the tree. Everything visual here was therefore **authored from the product's written
rules plus the stated styling reference**, not recreated from source. Where a decision
had no basis in the source, it is flagged in §7.

## 2. The product, in brief

Three knowledge layers — **sources** (evidence) → **bundles** (OKF concepts, the map) →
**graph** (derived) — with **records** the platform keeps over them (guides, compositions,
usage, bindings, audit), citing concepts by IRI and never restating them.

Two kinds of user: **people** (Admin, Editor, Viewer) running business activities and
curating knowledge, and **agents** arriving through the MCP surface. One deployment holds
many **workspaces**; a workspace is one company.

The surfaces the rail lists, each holding groups of screens (§4, *The shell*):

- **Ask** — a question, a cited answer, and what it could not answer. Every role.
- **Knowledge** — search, guides and the map's concepts for every role; its curation
  screens for Admins and the owners of a domain. A search hit is typed by knowledge layer
  and wears its trust or sensitivity word. A guide is assembled *Brief* and quoted
  *Detail* layers over the concepts, with coverage.
- **Inbox** — what waits on a person who decides something: Admins, and the owners of a
  domain.
- **Control Centre** — the one Admin surface, in eight groups: Overview, Suggestions,
  Sources, Agent Operations, Questions, People, Personal data and System.

The avatar menu in the band holds the person's name, their role and "Sign out".

## 3. Content fundamentals

A screen is written in its reader's words, not its builders'. `CONTEXT.md` names things
for the code; a screen borrows a glossary word only when a reader would say it themselves,
or needs that exact word to act.

**Never contradict the glossary.** A screen that names a thing uses the glossary's word for
it, never a rival one. *Map*,
never *graph*, on a screen. *Workspace*, never *organisation*, *account*, *team* or *site*.
*Client*, never *connector*, for an MCP host. *Screen*, never *section*, for Control Centre.
Terms marked *Avoid* in the glossary are banned outright. The glossary's definition is never
a screen's sentence.

**Trust words are a closed set** and appear verbatim:
Checked by <person> · Checked by the platform · Unchecked · Changed since checked ·
Out of date · Draft · Restricted · Left · Deprecated. Two riders only — *· imported* and
*· source moved on*. Never *verified*, *trusted*, *confidence*, *score*, or a colour alone.

**Tone: precise, confident, grounded.** The platform names the number, does not hedge, and
shows its evidence. It states what is true and what is not; it never reassures, apologises
or enthuses. It is written for a bid writer under deadline, not a browser.

- *Precise* — the count, the date, the name. "Three passages mention it", not "a few sources".
- *Confident* — no "we think", "it seems", "you might want to". If it is uncertain, say what is missing.
- *Grounded* — every claim is attached to something a reader can open. No assertion floats.

British spelling and UK conventions throughout.

- Write: "Nothing on the map answers this. Three passages mention it."
- Not: "Oops! We couldn't find anything — try rephrasing!"
- Write: "One governed write. Audited under your name."
- Not: "Are you sure? This action cannot be undone."
- Write: "Checked by Priya Shah · 3 March 2026"
- Not: "✅ Verified 6 months ago"

**Person.** Second person for what the reader does ("you asked", "your queue"); never
first-person plural. No "we". The audit log's actor column names the platform's own acts
"the platform". That column names an actor; it doesn't address the reader.

**Casing.** Sentence case everywhere — headings, buttons, tabs, table headers (the only
upper-case is the micro-label at 11px with 0.06em tracking). Proper nouns keep their case:
Control Centre, Admin, Editor, Viewer, Answer (the concept kind), Restricted, Internal, Public.

**Consequence before the click.** Every action states its effect in the label or the line
beside it, not in a tooltip and not after the fact: "Accept 12 concepts", "Save as an
Answer", "One governed write."

**Dates and numbers.** UK long form — 3 March 2026; with time, 09:41 · 30 August 2026.
Never 03/03/2026. Money as £1,240.00. Relative time only under a minute.

**Emoji: never.** Not in the interface, not in empty states, not in documentation. Unicode
symbols are used only where they are typographic (·, —, ’, “ ”, ✕ on a dismiss control).

**Clarity.** A screen answers three questions, in order: where am I, what happened, what do I
do next. Say those, then stop.

- Say what to do, not how the system works. Explain a rule only when the reader can't act
  without it.
- Use the reader's words. A glossary word goes on a screen only when the reader needs that
  exact word to act, and it's explained where they first meet it.
- Give one next action, its label naming the effect: "Join Acme", not "Continue".
- Don't repeat the heading in the body, or the body in the button.
- An empty state says what is missing, in one line. Add an action only where the screen has
  no other way to take it.
- A consequence line states the one thing the reader would regret not knowing: that it can't
  be undone, or who will see it. Record-keeping isn't a consequence for the reader.
- An error says what went wrong, then what to do. Name who can fix it only when the reader
  can't. A code word never leads.
- "The platform" isn't a character. Write "Nothing was saved", not "The platform did not
  answer".
- Turn stacked conditions into two short sentences.

## 4. Visual foundations

**Register.** Quiet, dense, mechanical — a **blueprint**, not a dashboard. The page is a
modular grid; cards, figures and buttons are objects drawn on it: square-cornered,
hairline-bordered, and where an object registers against the grid, a "+" mark on its
corners. Cards and figures stay transparent line drawings. The primary button is the one
solid object on the board — an accent fill that keeps the square corners and the marks.
Hairlines rather than shadows; near-black rather than colour; type doing the work.

**The modular grid.** 32px module (`--grid-module`), 64px for wide layouts. It is not a
metaphor: the layout is set on it and `GridPattern` draws the same pitch behind the page,
so the substrate and the content agree. One grid per screen, masked away from reader prose.

**Colour.** A cool grey ramp carries everything structural — page `#fcfcfd`, cards
`#ffffff`, lines `#dfe1e6`, text `#17191c`. One accent, **ink blue `#2e4bd4`**, and it is
*interactive only*: links, focus rings, and the accent button at a gate. Four semantic
hues — green `#137a52`, amber `#a55d09`, red `#c0362c`, violet `#6741c4` — appear only as a
50-level tint plus a 700-level word, behind a label that already says the same thing.
Dark theme is a full alias flip on `[data-theme="dark"]`, page `#0b0c0e`. Never a gradient,
never a coloured left border, never colour as the only signal.

**Type.** Geist for everything, Geist Mono for identity and machine strings (IRIs, commit
hashes, actor ids, citation markers, tabular figures). Only three weights ship: 400, 500,
600. Interface body is **14px**; reader prose is **16px at 1.65** on a 68ch measure.
Tracking tightens as size grows (−0.022em display → −0.006em body); the 11px micro-label
opens to +0.06em upper case. Tabular figures wherever numbers stack.

**Spacing.** 4px base, with 2px and 6px for dense controls. Layout constants: the 56px
rail (`--rail-w`), the 248px secondary nav (`--sidebar-w`), the 48px band (`--band-h`),
the 1200px page maximum (`--page-max`) and the 68ch prose measure (`--measure-prose`).
Tailwind reads them as `w-rail`, `w-sidebar`, `h-band`, `max-w-page` and
`max-w-measure`. Controls are 26 / 32 / 40px tall.

**The shell.** A full-width band runs across the top of every workspace and Console
screen, above the rail and the secondary nav. It has three cells:

1. As wide as the rail: the logo, which links to the person's home.
2. As wide as the secondary nav: the workspace switcher, then the sidebar toggle.
3. The rest: the breadcrumb, ⌘K jump-to and the avatar menu.

Hiding the secondary nav takes only the nav out of the row below the band, so nothing in
the band moves, to the pixel. The band has no primary-action slot: a screen's primary
action sits in that screen's own row. The breadcrumb names the surface, the group, the
screen and the open tab at every width, and every part but the last links to its place;
only the wide band's cell may truncate the middle parts. A name the next part repeats is
said once, by the deeper part, so Ask's home reads "Ask" alone. When a switch of
workspace is pending or fails, the band's outcome line says so in words, with the next
step — never a toast.

Below the band, the rail lists the surfaces the person may use, with a bottom group for
utilities: Keyboard shortcuts. The secondary nav lists the open surface's groups, each a
heading over its screens, each screen with an icon. The open screen is marked in
greyscale, and no visible heading repeats the surface's name from the rail. A surface,
group or screen that is not built appears nowhere, except a role's home.

Below the wide breakpoint the band takes two rows and scrolls with the page. The first
keeps the button that opens the rail and secondary nav as a sheet, the logo, the
switcher, a ⌘K trigger, the Keyboard shortcuts trigger and the avatar menu. The second
holds the breadcrumb, which wraps and never truncates. Nothing scrolls sideways at 320px.

**Width.** A screen's content fills the pane up to the page maximum. Its paragraphs and
headings keep the prose measure, and a table or form uses the width it is given. The shell
marks the screen's wrapper `data-screen-content` and gives it `max-w-page`; the rule in
`styles.css` caps the text inside, and lifts the cap inside a table, a dialog or a sheet.
A screen declares nothing. A line that must run wider says so with a utility, which
always wins over the rule.

**Corners: square.** Every step of the radius ramp resolves to `0`. The ramp names are kept
so consumers can still write `--radius-md`, but nothing rounds. `--radius-full` survives
for the three genuinely circular controls — the loading spinner ring, a radio and the
avatar — and nothing else.

**Registration marks.** A `+` at 7px arms, 1px, centred *on* the corner. It marks a
board-level object, and it is rationed: **page regions and module frames · figures,
diagrams and specimens · a card that is a direct child of the grid · the primary button ·
an empty state or drop zone.** Never on inputs, selects, tags, trust tags, badges, table
rows, nav items, menu items, tooltips, toasts, anything under 32px tall, or anything inside
a parent that already carries marks. A committing action *repeated per row* takes the
unmarked `accent` fill rather than `primary`. **One marked level per stack, at most three
marked objects per screen** — if everything is registered, nothing is. `Frame` is the marked
primitive; `Card` takes `marks` as an opt-in.

**Cards.** A 1px `--border-subtle` hairline, square corners, white surface, no shadow at
rest. Header row (title + optional meta + right-aligned actions), body, optional sunken
footer strip for provenance. No coloured accents, no left borders, no elevation on hover.
A **`Frame`** is the transparent counterpart: no fill, one hairline, marks on — for a
figure or a region rather than content.

**Shadows.** Five steps, all short and low-alpha. Only a dialog gets `--shadow-dialog`;
everything else is xs or sm. A dropdown or popover uses md.

**Backgrounds and texture.** Never a gradient, never imagery, never illustration. Depth
comes from a sunken surface (`#f7f8f9`) behind the rail, table headers and quoted passages
— and from three rationed textures, ported from **Magic UI**:

| Component | npm | Where it is allowed |
| --- | --- | --- |
| `GridPattern` | `@magicui/grid-pattern` | The page substrate. One per screen, behind everything, at the layout's own 32px pitch. Not inside a card or dialog. |
| `DotPattern` | `@magicui/dot-pattern` | Bounded empty areas only — empty states, drop zones, the unbuilt region of a figure. It *means* "nothing is here yet", so never behind content. |
| `NoiseTexture` | `@magicui/noise-texture` | Dark and accent surfaces only, at 3.5–5%: the dark page, the dialog scrim, a full-bleed accent band. Never on a white card, never over reader prose, never above 5%. Off under `prefers-reduced-transparency`. |

Texture is grain and substrate, not decoration. If a texture is legible as a pattern, it is
turned up too far.

**Borders.** `--border-subtle` for internal divisions, `--border-default` for control
edges, `--border-strong` for hover on an interactive container. 1px, never 2 — except the
1.5px tab underline and the 2px focus ring.

**Hover.** Surfaces tint one step (`--surface-hover`); interactive containers darken their
border; ghost controls gain a background rather than a colour. No lift, no scale, no
shadow change.

**Press.** A 0.5px downward nudge on buttons and a one-step darker fill. Nothing shrinks.

**Focus.** Always visible, never removed: a 2px `--accent-200` ring plus a 1px
`--accent-600` edge. Keyboard order is the DOM order.

**Motion.** 80–240ms, one curve (`cubic-bezier(.2,0,.13,1)`), fades and 4px rises only. No
bounce, no spring, no parallax, no entrance choreography. Answers stream — that
is the only continuous motion in the product. `prefers-reduced-motion` collapses everything
to 1ms.

**Transparency and blur.** Used twice, deliberately: a dialog scrim
(`rgba(11,12,14,.44)` + 2px blur) and a sticky bar backdrop. Nowhere else — no frosted
cards, no translucent panels.

**Disclosure, not layers.** First view shows what is needed to judge, one
disclosure reveals more, the action sits beside it. Two levels for a Viewer, never three.
A modal exists only for an irreversible act.

**Imagery.** None. The product ships no photography or illustration; a screen with nothing
to show says so in words.

## 5. Iconography

**Phosphor**, at 16px in the interface (18–20px in empty states), regular weight,
`currentColor`. In the application this is **`@phosphor-icons/react`**; on a static page or
a specimen card it is the same set as **`@phosphor-icons/web`**, and the kebab-case names
are identical across both — a screen built here ports to the app with no glyph changes.
This remains a **flagged substitution**: the repository ships no icon set, sprite or icon
font of its own. Its one SVG is the logo.

```jsx
import { MagnifyingGlass } from "@phosphor-icons/react";   // application
```
```html
<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css">
<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/bold/style.css">
```

Rules: regular weight everywhere; bold for an active nav item; fill only inside a solid
accent chip; **never duotone**. An icon never carries meaning alone — it accompanies a label
or an `aria-label`. One family only, no second set, no emoji, no Unicode
pictographs. The glyphs in use are the ones `apps/web/src/shared/icon.tsx` maps, and a new
one is added there. The `Icon` component is the only way to render one.

**The one exception is `lucide-react`, inside the vendored registry primitives under
`apps/web/src/shared/ui/` and nowhere else**, because a chevron inside a `Select` is behaviour,
not meaning (ADR 0033).

**Logo.** Two square brackets with a square between them, like a citation marker:
`assets/logo.svg`, imported as `@better-answers/design-system/assets/logo.svg`. It is one
path on a 16-unit grid in `currentColor`, so it takes the colour of the text around it,
and its weight is Geist Mono's own bracket, between 500 and 600 (`assets/README.md` gives
the measurements). It stands in the band's first cell, on the sign-in screens and as the
browser's tab icon, at a multiple of 8px so its edges stay on whole pixels: 16px as the
tab icon, 24 or 32px in the band. Its accessible name is `better-answers`.

**Name.** The product's name is `better-answers` everywhere a person reads it: a screen,
the tab title, the api's pages, an email and its sender name. Lower-case and hyphenated,
at the start of a sentence as anywhere else. Beside the logo it is set in Geist Mono 500;
in running text it takes the text's own face. The domain is `better-answers.com`. Never
"BetterAnswers", never "Better-Answers", never "BA", and never two capitalised words.

## 6. What is in this repository

```
package.json            the workspace package apps/web imports; wires the two self-hosted faces; exports ./assets/*
styles.css              the token imports and the width rule — the one file consumers link
tokens/                 fonts · fonts-hosted · fonts-remote · colors · typography · spacing · radius · blueprint · elevation · motion · semantic · keyframes · tailwind-bridge
guidelines/             foundation specimen cards
assets/                 logo.svg, the logo
SKILL.md                Agent Skills entry point
```

### Components — removed (T-035, ADR 0033)

This package shipped a full set of `.jsx` primitives and a `ui_kits/platform/`
click-through, authored before any application existed. Both were **deleted when the
application arrived**: the components the product uses come from the shadcn, Kibo UI and
AI Elements registries, and a second set nothing imports is drift. What they proved — that the register can be built — the guidelines cards
still record.

What stays is the part an application consumes: the tokens, `styles.css`, the logo, and
`tokens/tailwind-bridge.css`, which turns the tokens into Tailwind v4 theme values so a
registry component comes out in this styling with no edit to the component file.

### UI kit

shadcn · Kibo UI · AI Elements.

Three registries, one rule: they own behaviour — keyboard, focus, ARIA, virtualisation,
streaming. We own meaning — the trust words, the citation unit, the register, the marks,
and every word on a screen. Where the two meet, take theirs and skin it. The auth screens
are the platform's own, on the auth module's hooks over the better-auth client (ADR 0033,
amended 2026-09-05); the client says *organization* throughout and the module's word map
says *workspace*; that map is not optional.

**A pill is Kibo UI's Pill** (owner, 25/09/2026; <https://www.kibo-ui.com/components/pill>).
Every pill a screen shows — a role, a group, an invitation's state, a count — is that
component, installed through the registry with its notices entry and skinned by the tokens.
It is never shadcn's Badge restyled or a hand-rolled span. Screens built before this date are
not swept.

The seven product-specific components the set used to hold are the ones to rebuild first on
top of a registry primitive, because nothing off the shelf carries their meaning:
**`TrustTag`** (the closed set of trust words, `CONTEXT.md` and ADR 0019),
**`Citation`** (concept, source, locator, passage on one disclosure, ADR 0015),
**`CoverageBar`**, **`SummaryList`** and **`Details`** (GOV.UK *semantics* without the
GOV.UK brand), **`Icon`** (the Phosphor substitution in one file) and
**`Frame`** (the blueprint object with its registration marks).

### Foundation cards

`guidelines/` — Colors (6), Type (5), Spacing (4), Motion (1), Brand (5, including
**Registration marks** — where a "+" is allowed).

## 7. Flagged substitutions and open questions

1. **Fonts.** No brand font binaries exist in the source. **Geist and Geist Mono** were chosen as the closest match to the stated reference styling, and the substitution stands. Since T-035 the product **self-hosts** them from this package's own `@fontsource-variable/geist` and `-geist-mono` dependencies (`tokens/fonts-hosted.css`), so no screen makes a third-party request; the specimen cards under `guidelines/`, which are opened straight from disk and cannot resolve a package name, still link Google Fonts through `tokens/fonts-remote.css`. Replace the two `tokens/fonts-*.css` files if a licensed brand font exists; `tokens/fonts.css` names the families and stays.
2. **Icons.** No icon set exists in the source. **Phosphor** — `@phosphor-icons/react` in the app, `@phosphor-icons/web` on a page — flagged above.
3. **Logo.** Drawn to the owner's description of 30 September 2026: two square brackets with a square between them. `assets/logo.svg` is the logo unless the owner replaces it. The same decision made the name `better-answers` everywhere a person reads it.
4. **Accent colour.** Ink blue `#2e4bd4` was chosen, not found. The source specifies no palette — only that colour never carries a signal alone.
7. **Textures.** `GridPattern`, `DotPattern` and `NoiseTexture` are ports of the corresponding Magic UI components, retuned to these tokens rather than pulled from npm — the design system ships no build step. In an application, install `@magicui/grid-pattern`, `@magicui/dot-pattern` and `@magicui/noise-texture` and pass the same tokens.
5. **Dark theme.** Authored on the reference styling's convention, not on evidence from the source.
6. **Screen layouts.** Grounded in `CONTEXT.md` and the ADRs (which name every screen and its content) but not in any interface code, because none exists yet.
