# better-answers — design system

A living company knowledge map for UK SMBs, built on OKF v0.2. Every answer cited,
permission-aware and explainable. This repository is the brand and interface system for
the hosted product at `app.better-answers.com`.

---

## 1. The product - summary

Three knowledge layers — **sources** (evidence) → **bundles** (OKF concepts, curated) →
the **map** (derived) — with **records** the platform keeps over them (guides, write-ups,
usage, connected sources, audit), citing concepts by IRI.

Two kinds of user: **people** (Admin, Editor, Viewer) running business activities and
curating knowledge, and **agents** arriving through the MCP surface. One deployment holds
many **workspaces**; a workspace is one company.

The areas the rail lists, each holding groups of pages:

- **Ask** — a question, a cited answer, and what it could not answer.
- **Knowledge** — search, guides and the map's concepts.
- **Inbox** — what waits on a person.
- **Control Centre** — the Admin area, in eight groups: Overview, Suggestions,
  Sources, Models, Questions, People, Personal data and System.

## 2. Content fundamentals

**To ensure consistency, use the platform's glossary:** `CONCEPTS.md`

**Trust words are a closed set**, written verbatim and always as text:
Verified by <person> · Verified automatically · Unverified · Changed since verified ·
Out of date · Draft · Left · Deprecated.

**British spelling and UK conventions throughout.**

**Dates and numbers.** UK long form — 3 March 2026; with time, 09:41 · 30 August 2026.
Money as £1,240.00. Relative time only under a minute.

## 3. Visual foundations

**Register.** Quiet, dense, mechanical — a **blueprint**, not a dashboard. The page is a
modular grid; cards, figures and buttons are objects drawn on it: square-cornered,
hairline-bordered, and where an object registers against the grid, a "+" mark on its
corners. Cards and figures stay transparent line drawings. The primary button is the one
solid object on the board — an accent fill that keeps the square corners and the marks.
Hairlines rather than shadows; near-black rather than colour; type doing the work.

**The modular grid.** 32px module (`--grid-module`), 64px for wide layouts. It is not a
metaphor: the layout is set on it and `GridPattern` draws the same pitch behind the page,
so the substrate and the content agree. One grid per page, masked away from reader prose.

**Colour.** A cool grey ramp carries everything structural — page `#fcfcfd`, cards
`#ffffff`, lines `#dfe1e6`, text `#17191c`. A field, checkbox or radio is found by its edge,
so that edge is `--border-control` (`#727781`), 3:1 on every surface in both themes; every
other line stays a hairline. One accent, **ink blue `#2e4bd4`**, and it is
*interactive only*: links, focus rings, and the accent fill — the primary button, and the
unmarked accent button on an action repeated per row. Four semantic hues — green `#137a52`, amber `#a55d09`, red `#c0362c`, violet `#6741c4` — appear only as a
50-level tint plus a 700-level word, behind a label that already says the same thing.
Dark theme is a full alias flip on `[data-theme="dark"]`, page `#0b0c0e`. The attribute goes
on `<html>` and nowhere else, because the Tailwind bridge's aliases resolve at `:root`. Never a gradient,
never a coloured left border, never colour as the only signal.

**Type.** Geist for everything, Geist Mono for identity and machine strings (IRIs, commit
hashes, actor ids, footnotes, tabular figures). Only three weights ship: 400, 500,
600. Interface body is **14px**; reader prose is **16px at 1.65** on a 68ch measure.
Tracking tightens as size grows (−0.022em display → −0.006em body); the 11px micro-label
opens to +0.06em upper case. Tabular figures wherever numbers stack.

**Spacing.** 4px base, with 2px and 6px for dense controls. Layout constants: the 56px
rail (`--rail-w`), the 248px menu (`--sidebar-w`), the 48px band (`--band-h`),
the 1200px page maximum (`--page-max`) and the 68ch prose measure (`--measure-prose`).
Tailwind reads them as `w-rail`, `w-sidebar`, `h-band`, `max-w-page` and
`max-w-measure`. Controls are 26 / 32 / 40px tall.

**The shell.** A full-width band runs across the top of every workspace and Console
page, above the rail and the menu. It has three cells:

1. As wide as the rail: the logo, which links to the person's home.
2. As wide as the menu: the workspace switcher, then the sidebar toggle.
3. The rest: the breadcrumb, ⌘K jump-to and the avatar menu.

Hiding the menu takes only the nav out of the row below the band, so nothing in
the band moves, to the pixel. The band has no primary-action slot: a page's primary
action sits in that page's own row. The breadcrumb names the area, the group, the
page and the open tab at every width, and every part but the last links to its place;
only the wide band's cell may truncate the middle parts.

Below the band, the rail lists the areas the person may use, with a bottom group for
utilities: Keyboard shortcuts. The menu lists the open area's groups, each a
heading over its pages, each page with an icon. The open page is marked in
greyscale, and no visible heading repeats the area's name from the rail.

Below the wide breakpoint the band takes two rows and scrolls with the page. The first
keeps the button that opens the rail and menu as a sheet, the logo, the
switcher, a ⌘K trigger, the Keyboard shortcuts trigger and the avatar menu. The second
holds the breadcrumb, which wraps and never truncates. Nothing scrolls sideways at 320px.

**Width.** A page's content fills the pane up to the page maximum. Its paragraphs and
headings keep the prose measure, and a table or form uses the width it is given. The shell
marks the page's wrapper `data-page-content` and gives it `max-w-page`; the rule in
`styles.css` caps the text inside, and lifts the cap inside a table, a dialog or a sheet.

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
marked objects per page** — if everything is registered, nothing is. `MarkedRegion` is the marked
primitive; `Card` takes `marks` as an opt-in. `styles.css` draws every mark from one rule on
`data-marks`, and draws none inside a marked parent, so the nesting rule holds by itself. In the
application `MarkedRegion` is `apps/web/src/shared/blueprint.tsx` and `Card` is
`apps/web/src/shared/ui/card.tsx`; the primary button marks itself in `--accent-300` at 32px and
up, and its `accent` variant is the same fill unmarked.

**Cards.** A 1px `--border-subtle` hairline, square corners, white surface, no shadow at
rest. Header row (title + optional meta + right-aligned actions), body, optional sunken
footer strip for provenance. No coloured accents, no left borders, no elevation on hover.
A **`MarkedRegion`** is the transparent counterpart: no fill, one hairline, marks on — for a
figure or a region rather than content.

**Shadows.** Five steps, all short and low-alpha. Only a dialog gets `--shadow-dialog`;
everything else is xs or sm. A dropdown or popover uses md.

**Backgrounds and texture.** Never a gradient, never imagery, never illustration. Depth
comes from a sunken surface (`#f7f8f9`) behind the rail, table headers and quoted passages
— and from three rationed textures, ported from **Magic UI**:

| Component | npm | Where it is allowed |
| --- | --- | --- |
| `GridPattern` | `@magicui/grid-pattern` | The page substrate. One per page, behind everything, at the layout's own 32px pitch. Not inside a card or dialog. |
| `DotPattern` | `@magicui/dot-pattern` | Bounded empty areas only — empty states, drop zones, the unbuilt region of a figure. It *means* "nothing is here yet", so never behind content. |
| `NoiseTexture` | `@magicui/noise-texture` | Dark and accent surfaces only, at 3.5–5%: the dark page, the dialog scrim, a full-bleed accent band. Never on a white card, never over reader prose, never above 5%. Off under `prefers-reduced-transparency`. |

Texture is grain and substrate, not decoration. If a texture is legible as a pattern, it is
turned up too far. `GridPattern` and `DotPattern` are built: each draws its texture as the
background of the element it wraps, through `data-grid-pattern` and `data-dot-pattern` in
`styles.css`. `NoiseTexture` waits for a dark or accent surface to land on.

**Borders.** `--border-subtle` for internal divisions, `--border-default` for control
edges, `--border-strong` for hover on an interactive container. 1px, never 2 — except the
1.5px tab underline and the 2px focus ring.

**Hover.** Surfaces tint one step (`--surface-hover`); interactive containers darken their
border; ghost controls gain a background rather than a colour. No lift, no scale, no
shadow change.

**Press.** A 0.5px downward nudge on buttons and a one-step darker fill. Nothing shrinks.

**Focus.** Always visible, never removed: a 2px `--accent-200` ring, with a 1px
`--accent-600` edge drawn outside it, `--accent-400` in dark. The edge meets the page and the ring meets the control, so
one of them holds 3:1 whatever the control is filled with. The bridge gives every focusable
element this ring over the kit's own. Keyboard order is the DOM order.

**Motion.** 80–240ms, one curve (`cubic-bezier(.2,0,.13,1)`), fades and 4px rises only. No
bounce, no spring, no parallax, no entrance choreography. Answers stream — that
is the only continuous motion in the product. `prefers-reduced-motion` collapses everything
to 1ms.

**Transparency and blur.** Used twice, deliberately: a dialog scrim
(`rgba(11,12,14,.44)` + 2px blur) and a sticky bar backdrop. Nowhere else — no frosted
cards, no translucent panels.

**Disclosure, not layers.** First view shows what is needed to judge, one
disclosure reveals more, the action sits beside it. Two levels for a Viewer, never three.
A modal exists only for an irreversible action.

## 4. Iconography

**Phosphor**, at 16px in the interface (18–20px in empty states), regular weight,
`currentColor`. In the application this is **`@phosphor-icons/react`**; on a static page or
a specimen card it is the same set as **`@phosphor-icons/web`**, and the kebab-case names
are identical across both — a page built here ports to the app with no glyph changes.
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
`apps/web/src/shared/ui/` and nowhere else**.

**Logo:** `assets/logo.svg`, imported as `@better-answers/design-system/assets/logo.svg`.

**Name.** The product's name is `better-answers` everywhere a person reads it: a page,
the tab title, the api's pages, an email and its sender name. Lower-case and hyphenated,
at the start of a sentence as anywhere else. Beside the logo it is set in Geist Mono 500;
in running text it takes the text's own face. The domain name is `better-answers.com`.

## 5. What is in this repository

```
package.json            the workspace package apps/web imports; wires the two self-hosted faces; exports ./assets/*
styles.css              the token imports, the width rule, the mark and the two textures — the one file consumers link
tokens/                 fonts · fonts-hosted · fonts-remote · colors · typography · spacing · radius · blueprint · elevation · motion · semantic · keyframes · tailwind-bridge
guidelines/             foundation specimen cards
assets/                 logo.svg, the logo
SKILL.md                Agent Skills entry point
```

### UI kit

shadcn · Kibo UI · AI Elements.

Three registries, one rule. They own behaviour: keyboard, focus, ARIA, virtualisation and
streaming. We own meaning: the trust words, the citation unit, the register and the marks.
Where the two meet, take theirs and skin it. The web's wording follows Kibo UI's patterns,
and in it the trust words and the glossary's words stay the platform's own. The auth pages
are the platform's own, on the auth module's hooks over the better-auth client; Better Auth's client says *organization* throughout and the module's word map says *workspace*; that map is not optional.

**Start from a Kibo UI pattern.** Build a page, a dialog or an empty state from a pattern where
one fits, and keep its wording. The patterns are shown by kind at
<https://www.kibo-ui.com/patterns>. A pattern is a demonstration file and no registry item, so
the CLI cannot install it. Copy it by hand into `apps/web/src/shared/ui/kibo-ui/`.

### Foundation cards

`guidelines/` — Colors (6), Type (5), Spacing (4), Motion (1), Brand (5, including
**Registration marks** — where a "+" is allowed).