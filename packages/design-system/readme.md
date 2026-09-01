# Better Answers — design system

A living company knowledge map for UK SMBs, built on OKF v0.2. Every answer cited,
permission-aware and explainable. This repository is the brand and interface system for
the hosted product at `better-answers.com`.

---

## 1. Where this came from

| Source | Path / link | What was taken from it |
| --- | --- | --- |
| Better Answers repository (mounted, read-only) | `better-answers/` | Product definition, glossary, UX and accessibility rules, the reader-facing word set, Control Centre's six screens |
| `docs/vision.md` | in that repo | The one-line positioning, the three knowledge layers, who uses it |
| `CONTEXT.md` | in that repo | The **domain glossary** — the source of truth for every word on a screen |
| `CODING_RULES.md` | in that repo | `[UX1]` disclosure model, `[UX2]` latency and keyboard budget, `[A11Y1]` WCAG 2.2 AA + GOV.UK semantics |
| `docs/adr/0001–0027` | in that repo | Answer contract (0016), citation markers (0015), the write path (0012), trust derivation (0019), open-core (0027) |
| Styling brief (from the user) | — | "better-auth, Vercel, Linear" — the visual register |

**Important: the repository contains no interface code.** It is pre-build: `app/`, `web/`
and `worker/` are described in `AGENTS.md` but do not exist on disk yet, and there are no
components, stylesheets, fonts, icons or logo files anywhere in the tree. Everything
visual here is therefore **authored from the product's written rules plus the stated
styling reference**, not recreated from source. Where a decision had no basis in the
source, it is flagged in §7.

## 2. The product, in brief

Three knowledge layers — **sources** (evidence) → **bundles** (OKF concepts, the map) →
**graph** (derived) — with **records** the platform keeps over them (guides, compositions,
usage, bindings, audit), citing concepts by IRI and never restating them.

Two kinds of user: **people** (Admin, Editor, Viewer) running business activities and
curating knowledge, and **agents** arriving through the MCP surface. One deployment holds
many **workspaces**; a workspace is one company.

Surfaces the design system dresses:

- **Ask** — a question, a cited answer, and what it could not answer.
- **Search** — hits typed by knowledge layer, each wearing its trust or sensitivity word.
- **Guides** — assembled *Brief* and quoted *Detail* layers over the concepts, with coverage.
- **Control Centre** — the one Admin surface, in six screens: Sources, Suggestions, Knowledge, Questions, People, System.
- **Account** — a person's own small page.

## 3. Content fundamentals

The product's writing is already specified more tightly than most brands specify theirs,
because `CONTEXT.md` is a glossary that *code obeys*. The design system inherits it.

**The glossary is binding.** If a word is in `CONTEXT.md`, that word is the word. *Map*,
never *graph*, on a screen. *Workspace*, never *organisation*, *account*, *team* or *site*.
*Client*, never *connector*, for an MCP host. *Screen*, never *section*, for Control Centre.
Terms marked *Avoid* in the glossary are banned outright.

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

**Person.** Second person for what the reader does ("you asked", "your queue"); the
platform in the third ("the platform confirmed it"); never first-person plural. No "we".

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

**Length.** One sentence where one will do. Empty states are two lines and an action.
Errors are full sentences ending in a full stop, naming who can fix it.

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
never a coloured left border, never colour as the only signal (`[UX1]`, `[A11Y1]`).

**Type.** Geist for everything, Geist Mono for identity and machine strings (IRIs, commit
hashes, actor ids, citation markers, tabular figures). Only three weights ship: 400, 500,
600. Interface body is **14px**; reader prose is **16px at 1.65** on a 68ch measure.
Tracking tightens as size grows (−0.022em display → −0.006em body); the 11px micro-label
opens to +0.06em upper case. Tabular figures wherever numbers stack.

**Spacing.** 4px base, with 2px and 6px for dense controls. Layout constants: 248px left
rail, 48px top bar, 68ch prose measure, 1200px page maximum. Controls are 26 / 32 / 40px tall.

**Corners: square.** Every step of the radius ramp resolves to `0`. The ramp names are kept
so consumers can still write `--radius-md`, but nothing rounds. `--radius-full` survives
for the two genuinely circular controls — the loading spinner ring and a radio — and
nothing else.

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
bounce, no spring, no parallax, no entrance choreography. Answers stream (`[UX2]`) — that
is the only continuous motion in the product. `prefers-reduced-motion` collapses everything
to 1ms.

**Transparency and blur.** Used twice, deliberately: a dialog scrim
(`rgba(11,12,14,.44)` + 2px blur) and a sticky bar backdrop. Nowhere else — no frosted
cards, no translucent panels.

**Disclosure, not layers.** `[UX1]`: first view shows what is needed to judge, one
disclosure reveals more, the action sits beside it. Two levels for a Viewer, never three.
A modal exists only for an irreversible act.

**Imagery.** None. The product ships no photography or illustration; a screen with nothing
to show says so in words.

## 5. Iconography

**Phosphor**, at 16px in the interface (18–20px in empty states), regular weight,
`currentColor`. In the application this is **`@phosphor-icons/react`**; on a static page or
a specimen card it is the same set as **`@phosphor-icons/web`**, and the kebab-case names
are identical across both — a screen built here ports to the app with no glyph changes.
This remains a **flagged substitution**: the repository ships no icon set, sprite, icon
font or SVG of its own.

```jsx
import { MagnifyingGlass } from "@phosphor-icons/react";   // application
```
```html
<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css">
<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/bold/style.css">
```

Rules: regular weight everywhere; bold for an active nav item; fill only inside a solid
accent chip; **never duotone**. An icon never carries meaning alone — it accompanies a label
or an `aria-label` (`[A11Y1]`). One family only, no second set, no emoji, no Unicode
pictographs. Glyphs actually used: `magnifying-glass`, `tray`, `database`, `graph`,
`question`, `users`, `pulse`, `book-open`, `chat-text`, `copy`, `flag`, `check-circle`,
`warning`, `sliders-horizontal`, `funnel`, `plus`, `download-simple`,
`clock-counter-clockwise`, `keyboard`, `arrow-square-out`. The `Icon` component is the only
way to render one.

**Logo: there is none yet.** The source contains no logo, wordmark file or brand mark, so
none was drawn. Wherever a mark would go, the name is set in type — **Geist Mono 500,
−0.02em, lower case: `better-answers`**. One word, hyphenated, always lower case: the mark,
the handle and the domain (`better-answers.com`) are the same string. Never "Better
Answers", never "BetterAnswers", never "BA". **Logo and icon files are being produced
separately; when they land, drop the SVGs into `assets/` and replace the wordmark in
`ui_kits/platform/AppShell.jsx` and `thumbnail.html`.**

## 6. What is in this repository

```
styles.css              @import list only — the one file consumers link
tokens/                 fonts · colors · typography · spacing · radius · blueprint · elevation · motion · semantic · keyframes
components/             the reusable primitives (below)
guidelines/             foundation specimen cards
ui_kits/platform/       click-through recreation of the product
assets/                 (empty — logo and icon files are in production separately)
SKILL.md                Agent Skills entry point
```

### Components

Grouped by concern. Every one is a single `.jsx` with a sibling `.d.ts` and `.prompt.md`,
styled only through the CSS custom properties.

**core/** — `Button`, `IconButton`, `Input`, `Textarea`, `Select`, `Checkbox`,
`RadioGroup`, `Switch`
**display/** — `Card`, `Frame`, `Tag`, `TrustTag`, `Badge`, `SummaryList`, `DataTable`,
`EmptyState`, `Icon`
**feedback/** — `Dialog`, `Toast`, `Tooltip`, `NotificationBanner`, `Details`
**navigation/** — `SideNav`, `Tabs`
**knowledge/** — `Citation`, `CoverageBar`
**texture/** — `GridPattern`, `DotPattern`, `NoiseTexture`

#### Intentional additions

The source defines no component library, so the standard set was authored. Five additions
are specific to this product rather than generic:

- **`TrustTag`** — the closed set of reader-facing trust words (`CONTEXT.md`, ADR 0019). Without it, teams invent their own vocabulary, which the glossary forbids.
- **`Citation`** — the unit a reader checks: concept, source, locator, passage on one disclosure (ADR 0015).
- **`CoverageBar`** — a section's expectation minus what is included; count first, bar second.
- **`SummaryList`** and **`Details`** — GOV.UK Design System *semantics* without the GOV.UK brand, required by `[A11Y1]`.
- **`Icon`** — a wrapper so the Phosphor substitution lives in exactly one file.
- **`Frame`** — the blueprint object: a transparent line drawing with "+" registration marks. Without it, marks get sprinkled by hand and the register collapses.

### UI kit

`ui_kits/platform/` — Ask, Search, Guides, and Control Centre (Sources, Suggestions,
Knowledge). Questions, People and System are deliberately left blank with a disclaimer:
the source names them but specifies no interface. See its own `README.md`.

### Foundation cards

`guidelines/` — Colors (6), Type (5), Spacing (4), Motion (1), Brand (5, including
**Registration marks** — where a "+" is allowed).

## 7. Flagged substitutions and open questions

1. **Fonts.** No font binaries exist in the source. **Geist and Geist Mono** are loaded from Google Fonts as the closest match to the stated reference styling. Replace `tokens/fonts.css` if a licensed brand font exists.
2. **Icons.** No icon set exists in the source. **Phosphor** — `@phosphor-icons/react` in the app, `@phosphor-icons/web` on a page — flagged above.
3. **Logo.** None exists yet; none was drawn. The wordmark is `better-answers` set in Geist Mono. Logo and icon files are in production separately.
4. **Accent colour.** Ink blue `#2e4bd4` was chosen, not found. The source specifies no palette — only that colour never carries a signal alone.
7. **Textures.** `GridPattern`, `DotPattern` and `NoiseTexture` are ports of the corresponding Magic UI components, retuned to these tokens rather than pulled from npm — the design system ships no build step. In an application, install `@magicui/grid-pattern`, `@magicui/dot-pattern` and `@magicui/noise-texture` and pass the same tokens.
5. **Dark theme.** Authored on the reference styling's convention, not on evidence from the source.
6. **Screen layouts.** Grounded in `CONTEXT.md` and the ADRs (which name every screen and its content) but not in any interface code, because none exists yet.
