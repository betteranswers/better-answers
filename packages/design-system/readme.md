# better-answers — design system

A living company knowledge map for UK SMBs, built on OKF v0.2. Every answer cited,
permission-aware and explainable. This repository is the brand and interface system for
the hosted product at `better-answers.com`.

---

## 1. Where this came from

| Source | Path / link | What was taken from it |
| --- | --- | --- |
| The better-answers repository (mounted, read-only) | `better-answers/` | Product definition, glossary, UX and accessibility rules, the reader-facing word set, Control Centre's pages |
| `VISION.md` | in that repo | The one-line positioning, the three knowledge layers, who uses it |
| `CONCEPTS.md` | in that repo | The **domain glossary**: each entry a person meets is headed by the word a page uses, and an entry only the code meets is marked internal |
| `CODING_STANDARDS.md` | in that repo | disclosure model, latency and keyboard budget, WCAG 2.2 AA + GOV.UK semantics |
| `docs/archive/adr/0001–0027` | in that repo | Answer contract (0016), footnotes (0015), the write path (0012), trust derivation (0019), open-core (0027) |
| Styling brief (from the user) | — | "better-auth, Vercel, Linear" — the visual register |

**When this system was authored, the repository held no interface code.** It was
pre-build: `app/`, `web/` and `worker/` were described in `AGENTS.md` but did not exist on
disk, and there were no components, stylesheets, fonts, icons or logo files anywhere in
the tree. Everything visual here was therefore **authored from the product's written
rules plus the stated styling reference**, not recreated from source. Where a decision
had no basis in the source, it is flagged in §7.

## 2. The product, in brief

Three knowledge layers — **sources** (evidence) → **bundles** (OKF concepts, curated) →
the **map** (derived) — with **records** the platform keeps over them (guides, write-ups,
usage, connected sources, audit), citing concepts by IRI and never restating them.

Two kinds of user: **people** (Admin, Editor, Viewer) running business activities and
curating knowledge, and **agents** arriving through the MCP surface. One deployment holds
many **workspaces**; a workspace is one company.

The areas the rail lists, each holding groups of pages (§4, *The shell*):

- **Ask** — a question, a cited answer, and what it could not answer. Every role.
- **Knowledge** — search, guides and the map's concepts for every role; its curation
  pages for Admins and the owners of a collection. A search match is typed by knowledge layer
  and wears its trust or sensitivity word. A guide is assembled *Brief* and quoted
  *Detail* layers over the concepts, with coverage.
- **Inbox** — what waits on a person who decides something: Admins, and the owners of a
  collection.
- **Control Centre** — the one Admin area, in eight groups: Overview, Suggestions,
  Sources, Models, Questions, People, Personal data and System.

The avatar menu in the band holds the person's name, their role and the item that signs them
out.

## 3. Content fundamentals

A page is written in its reader's words. `CONCEPTS.md` heads every entry a person meets with
the word a page uses. An entry only the code meets is marked `_Internal._`.

**Write the glossary's word.** A page names each thing by the word that heads its glossary
entry, and by that word alone: *map* for the curated knowledge, *workspace* for one company,
*assistant* for Claude or ChatGPT connected to it, *page* for a place with its own address.
An internal entry's word stays in the code. Say a thing in the page's own sentence, and leave
the glossary's definition in the glossary.

**Trust words are a closed set**, written verbatim and always as text:
Verified by <person> · Verified automatically · Unverified · Changed since verified ·
Out of date · Draft · Left · Deprecated. Two riders may follow *Verified by*, and only these
two: *· imported* and *· source moved on*. A verifier who has since been erased reads
"Verified by a former member". A colour sits only behind a word that already says the same
thing. *Restricted* is a sensitivity value, one of three with Internal and Public.

**What a sentence is for.** A person on a page came to do something, and a sentence there
helps them do it. It is short and ordinary: the sentence they have already read in other
products, saying no more than they need to carry on. The web takes its wording from Kibo UI's
patterns (§6). Use Kibo's own string where one fits the product, and write a sentence in the
same manner where Kibo has none. A Kibo string that names a thing takes the glossary's word
for it, so Kibo's "Remove Team Member" is "Remove Member" here. Kibo's emoji and joke messages
are left out. New text follows this section even where older text beside it does not.

British spelling and UK conventions throughout.

Kibo's strings, by kind of text. A line that names a group, a workspace or a member had Kibo's
"project", "team" or "team member" in that place, and "everything in it" stands for Kibo's "all
projects and data". The web has no toast. A done message shows in a page's outcome line and
takes Kibo's done alert form, and a refusal shows as an alert.

| Kind of text | Reads |
| --- | --- |
| Error alert | "There was a problem processing your request. Please try again." |
| Done alert | "Your changes have been saved successfully." |
| Empty state | "No results found" with "Try adjusting your filters to see more results." |
| Empty state | "No groups yet" with "Get started by creating your first group." |
| Field message | "Please enter a valid email address.", "Verification code must be 6 characters." |
| Field help | "Must be at least 8 characters long.", "This will be visible to all members." |
| Dialog description | "Add a new member to your workspace with a specific role." |
| Confirmation | "Leave Workspace" with "Are you sure you want to leave this workspace? You will need to be re-invited to access it again." |
| Confirmation | "Remove Member" with "Are you sure you want to remove this member from the workspace? They will lose access to everything in it." |
| Verification | "We've sent a 6-digit code to your email address. Please enter it below." |

Three of Kibo's habits come with them:

- An instruction in an alert or a field message takes "Please": "Please try again.", "Please
  enter a valid email address."
- A done message says "successfully": "Your changes have been saved successfully."
- Where no specific error is written, a stock sentence stands (*Refusals*, below).

An empty state takes an action only where the page offers no other way to take it.

**Person.** The second person for what the reader does ("you asked", "your questions"). The
platform may be "we" where a sentence says what it did or could not do: "We've sent a 6-digit
code to your email address." The third person for everything else. The Audit log's actor column
names the platform's own actions "the platform": it names an actor and addresses no one.

**Casing.** Each kind of text takes the casing Kibo gives it. Kibo's patterns hold no page
heading and no navigation, so a page's heading and a name in the navigation take the card
title's casing. In Title Case an article, a conjunction and a short preposition stay in lower
case unless they come first or last, as in "Mark as Complete", and a word that is part of the
verb keeps its capital, as in "Sign In Again".

| Kind of text | Casing | Examples |
| --- | --- | --- |
| Page heading, card title, a name in the navigation | Title Case | "Audit Log", "Personal Data", "Recovery Codes" |
| Dialog, sheet and drawer title | Title Case | "Leave Workspace", "Remove Member", "Edit Profile" |
| Button, a confirmation's buttons included | Title Case | "Save Changes", "View Details", "Go Back", "Keep Member" |
| Menu item | Title Case | "View Details", "Mark as Complete", "Add Tags" |
| Tab | Title Case | "Personal Info", "Audit Log" |
| Table header | Title Case | "IP Address", "Display Name" |
| Form field label and legend | Title Case | "Display Name", "Email Address", "Personal Information" |
| Tick box and switch label | Sentence case | "Remember me", "Email notifications" |
| Empty state title | Sentence case, no full stop | "No results found", "No groups yet" |
| Description, help text, tooltip | Sentence case, with a full stop | "This will be displayed publicly.", "Must be at least 8 characters long." |
| Alert, done message, field message | Sentence case | "Your changes have been saved successfully.", "Please enter a valid email address." |

Proper nouns keep their case in every kind of text: Control Centre, Admin, Editor, Viewer,
Answer (the concept kind), Restricted, Internal, Public. A trust word is written as the closed
set writes it. Any other glossary word keeps its wording and takes the casing of the kind of
text it stands in, so the *Audit log* page's tab reads "Audit Log".

Casing is typed into each string by hand. A style or a function that recases a label would
recase a person's name, a workspace's name or an address inside it. The 11px micro-label is
the one text a style sets in upper case (§4).

**Consequence before the click.** A button's label is short: its verb, with the kind of thing
where the verb alone would not say enough. "Remove", "Save Changes", "Go Back". A person's or a
thing's own name goes in the confirmation's own name, which is a dialog's title or an inline
group's legend. What the action will do goes in the text that describes the control, in view
before the reader clicks: "This action cannot be undone." That text keeps a fact the reader
needs and nothing else on the page shows, and so does a done message. The "Remove Member"
confirmation above, opened on one member, is named "Remove Sam Okoro". It keeps its
description, and its buttons are "Keep Member" and "Remove". Where a list repeats one action on
every row, each control's accessible name carries its row's name.

**Refusals.** A person reads a refusal (`CONCEPTS.md`) as a sentence. It is the stock sentence
for its kind, and the table names each by its key:

| Key | Answers | Sentence |
| --- | --- | --- |
| Session | class *unauthenticated* | Your session has expired. Please sign in again. |
| Permission | class *forbidden* | You don't have permission to do this. |
| Gone | class *absent* | This is no longer available. Please reload the page. |
| Invalid | class *malformed* | Please check your entries and try again. |
| Unavailable | class *inapplicable* | This action isn't available. |
| Changed | class *conflict* | This has changed since you opened it. Please reload the page. |
| Not yet | class *precondition* | This can't be done yet. |
| General | a failure that is neither a refusal nor a missing response and has no sentence of its own, such as a status the page has no branch for | Something went wrong. Please try again. |
| Try again | no response to an action that is safe to repeat | There was a problem processing your request. Please try again. |
| Unconfirmed | no response to an action that is not safe to repeat, such as one that spends a code or would make a second set of recovery codes | We couldn't confirm that. Please reload the page to check. |
| Not loaded | no response to a read | This didn't load. Please try again. |
| Wait | too many attempts | Too many attempts. Please try again in 2 minutes. With no wait sent: Too many attempts. Please try again later. |
| Copy | a failed copy | Couldn't copy. Please select it and copy it manually. |

A refusal is one sentence, with a second only where the reader has something to do or needs a
fact to do it. It has a sentence of its own only when the reader can act and the stock sentence
would not tell them how, or when the stock sentence would leave them unaware of something the
page did for them:

- "This code has expired. Please request a new one."
- "Verification code is incorrect. 2 tries left."
- "Your role has changed. Please reload the page."

The wait sentence names nobody, because the limit reached is not always the reader's own. An
alert may say what the button beside it says: Kibo's own error alert pairs "Please try again"
with a Retry button.

**Dates and numbers.** UK long form — 3 March 2026; with time, 09:41 · 30 August 2026.
Money as £1,240.00. Relative time only under a minute.

**Symbols.** The only symbols beside the words are ·, — and ✕ on a dismiss control, in the
interface, in empty states and in documentation. An apostrophe or a quotation mark stays as
its source has it, straight or curly: a string taken from a Kibo pattern keeps its straight
marks, and text already in the tree keeps the marks it has.

## 4. Visual foundations

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
on `<html>` and nowhere else, because the Tailwind bridge's aliases resolve at `:root`. A person
picks light, dark or their device's on the Account page. Never a gradient,
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
only the wide band's cell may truncate the middle parts. A name the next part repeats is
said once, by the deeper part, so Ask's home reads "Ask" alone. When a switch of
workspace is pending or fails, the band's outcome line says so in words, with the next
step — never a toast.

Below the band, the rail lists the areas the person may use, with a bottom group for
utilities: Keyboard shortcuts. The menu lists the open area's groups, each a
heading over its pages, each page with an icon. The open page is marked in
greyscale, and no visible heading repeats the area's name from the rail. An area,
group or page that is not built appears nowhere, except a role's home.

Below the wide breakpoint the band takes two rows and scrolls with the page. The first
keeps the button that opens the rail and menu as a sheet, the logo, the
switcher, a ⌘K trigger, the Keyboard shortcuts trigger and the avatar menu. The second
holds the breadcrumb, which wraps and never truncates. Nothing scrolls sideways at 320px.

**Width.** A page's content fills the pane up to the page maximum. Its paragraphs and
headings keep the prose measure, and a table or form uses the width it is given. The shell
marks the page's wrapper `data-page-content` and gives it `max-w-page`; the rule in
`styles.css` caps the text inside, and lifts the cap inside a table, a dialog or a sheet.
A page declares nothing. A line that must run wider says so with a utility, which
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
figure or a region rather than content. *Frame* is the shell's word (`CONCEPTS.md`), so this
primitive never takes it.

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

**Imagery.** None. The product ships no photography or illustration; a page with nothing
to show says so in words.

## 5. Iconography

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
`apps/web/src/shared/ui/` and nowhere else**, because a chevron inside a `Select` is behaviour,
not meaning (ADR 0033).

**Logo.** Two square brackets with a square between them, like a footnote:
`assets/logo.svg`, imported as `@better-answers/design-system/assets/logo.svg`. It is one
path on a 16-unit grid in `currentColor`, so it takes the colour of the text around it,
and its weight is Geist Mono's own bracket, between 500 and 600 (`assets/README.md` gives
the measurements). It stands in the band's first cell, on the sign-in pages and as the
browser's tab icon, at a multiple of 8px so its edges stay on whole pixels: 16px as the
tab icon, 24 or 32px in the band. Its accessible name is `better-answers`.

**Name.** The product's name is `better-answers` everywhere a person reads it: a page,
the tab title, the api's pages, an email and its sender name. Lower-case and hyphenated,
at the start of a sentence as anywhere else. Beside the logo it is set in Geist Mono 500;
in running text it takes the text's own face. The domain name is `better-answers.com`. Never
"BetterAnswers", never "Better-Answers", never "BA", and never two capitalised words.

## 6. What is in this repository

```
package.json            the workspace package apps/web imports; wires the two self-hosted faces; exports ./assets/*
styles.css              the token imports, the width rule, the mark and the two textures — the one file consumers link
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

Three registries, one rule. They own behaviour: keyboard, focus, ARIA, virtualisation and
streaming. We own meaning: the trust words, the citation unit, the register and the marks.
Where the two meet, take theirs and skin it. The web's wording follows Kibo UI's patterns (§3),
and in it the trust words and the glossary's words stay the platform's own. The auth pages
are the platform's own, on the auth module's hooks over the better-auth client (ADR 0033,
amended 2026-09-05); Better Auth's client says *organization* throughout and the module's word map
says *workspace*; that map is not optional.

**Start from a Kibo UI pattern.** Build a page, a dialog or an empty state from a pattern where
one fits, and keep its wording (§3). The patterns are shown by kind at
<https://www.kibo-ui.com/patterns>. A pattern is a demonstration file and no registry item, so
the CLI cannot install it. Copy it by hand into `apps/web/src/shared/ui/kibo-ui/` and give it a
row in `apps/web/src/shared/ui/THIRD_PARTY_NOTICES.md`, which says what a pattern's row holds.

**A pill is Kibo UI's Pill** (owner, 25/09/2026; <https://www.kibo-ui.com/components/pill>).
Every pill a page shows — a role, a group, an invitation's state, a count — is that
component, installed through the registry with its notices entry and skinned by the tokens.
It is never shadcn's Badge restyled or a hand-rolled span. Pages built before this date are
not swept.

The seven product-specific components the set used to hold are the ones to rebuild first on
top of a registry primitive, because nothing off the shelf carries their meaning:
**`TrustTag`** (the closed set of trust words, `CONCEPTS.md` and ADR 0019),
**`Citation`** (concept, source, locator, passage on one disclosure, ADR 0015),
**`CoverageBar`**, **`SummaryList`** and **`Details`** (GOV.UK *semantics* without the
GOV.UK brand), **`Icon`** (the Phosphor substitution in one file) and
**`MarkedRegion`** (the blueprint object with its registration marks), which is built.

### Foundation cards

`guidelines/` — Colors (6), Type (5), Spacing (4), Motion (1), Brand (5, including
**Registration marks** — where a "+" is allowed).

## 7. Flagged substitutions and open questions

1. **Fonts.** No brand font binaries exist in the source. **Geist and Geist Mono** were chosen as the closest match to the stated reference styling, and the substitution stands. Since T-035 the product **self-hosts** them from this package's own `@fontsource-variable/geist` and `-geist-mono` dependencies (`tokens/fonts-hosted.css`), so no page makes a third-party request; the specimen cards under `guidelines/`, which are opened straight from disk and cannot resolve a package name, still link Google Fonts through `tokens/fonts-remote.css`. Replace the two `tokens/fonts-*.css` files if a licensed brand font exists; `tokens/fonts.css` names the families and stays.
2. **Icons.** No icon set exists in the source. **Phosphor** — `@phosphor-icons/react` in the app, `@phosphor-icons/web` on a page — flagged above.
3. **Logo.** Drawn to the owner's description of 30 September 2026: two square brackets with a square between them. `assets/logo.svg` is the logo unless the owner replaces it. The same decision made the name `better-answers` everywhere a person reads it.
4. **Accent colour.** Ink blue `#2e4bd4` was chosen, not found. The source specifies no palette — only that colour never carries a signal alone.
7. **Textures.** `GridPattern`, `DotPattern` and `NoiseTexture` are ports of the corresponding Magic UI components, retuned to these tokens rather than pulled from npm — the design system ships no build step. The application draws the first two from the same tokens without the npm items, whose SVGs take their pitch as numbers rather than the grid token.
5. **Dark theme.** Authored on the reference styling's convention, not on evidence from the source. It is measured in the browser: the suite audits every page a test leaves in both themes, words at 4.5:1 and control edges at 3:1.
6. **Page layouts.** Grounded in `CONCEPTS.md` and the ADRs (which name every page and its content) but not in any interface code, because none exists yet.
