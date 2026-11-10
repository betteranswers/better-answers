---
name: better-answers
description: A living map of a company's own knowledge, drawn as issued drawings.
colors:
  ink-blue: "#2e4bd4"
  ink-blue-deep: "#2639aa"
  ink-blue-pale: "#eef2ff"
  ink-blue-ring: "#bccbfe"
  page: "#fcfcfd"
  card: "#ffffff"
  sunken: "#f7f8f9"
  inset: "#f0f1f3"
  hairline-subtle: "#e8eaed"
  hairline: "#dfe1e6"
  hairline-strong: "#c6cad1"
  control-edge: "#727781"
  ink: "#17191c"
  body-ink: "#26292e"
  secondary-ink: "#565b64"
  muted-ink: "#727781"
  verified-tint: "#e8f6ef"
  verified-word: "#0f6141"
  stale-tint: "#fdf3e3"
  stale-word: "#864a06"
  draft-tint: "#f2eefc"
  draft-word: "#54329f"
  restricted-tint: "#fdeceb"
  restricted-word: "#9d2a22"
  danger: "#c0362c"
typography:
  title:
    fontFamily: "Geist Variable, Geist, -apple-system, Segoe UI, Helvetica, sans-serif"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.022em"
  section:
    fontFamily: "Geist Variable, Geist, -apple-system, Segoe UI, Helvetica, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.014em"
  heading-small:
    fontFamily: "Geist Variable, Geist, -apple-system, Segoe UI, Helvetica, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.014em"
  prose:
    fontFamily: "Geist Variable, Geist, -apple-system, Segoe UI, Helvetica, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "-0.006em"
  body:
    fontFamily: "Geist Variable, Geist, -apple-system, Segoe UI, Helvetica, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "-0.006em"
  meta:
    fontFamily: "Geist Variable, Geist, -apple-system, Segoe UI, Helvetica, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Geist Variable, Geist, -apple-system, Segoe UI, Helvetica, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: "0.06em"
  reference:
    fontFamily: "Geist Mono Variable, Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  none: "0px"
  full: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "6": "24px"
  "8": "32px"
  "12": "48px"
  "16": "64px"
  grid-module: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink-blue}"
    textColor: "{colors.card}"
    rounded: "{rounded.none}"
    padding: "8px 16px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.ink-blue-deep}"
  button-outline:
    backgroundColor: "{colors.page}"
    textColor: "{colors.body-ink}"
    rounded: "{rounded.none}"
    padding: "8px 16px"
    height: "32px"
  button-outline-hover:
    backgroundColor: "{colors.sunken}"
  input:
    backgroundColor: "{colors.page}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    height: "36px"
  card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.none}"
  title-block:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    width: "352px"
  title-block-cell:
    typography: "{typography.body}"
    padding: "8px 12px 10px"
  trust-tag-verified:
    backgroundColor: "{colors.verified-tint}"
    textColor: "{colors.verified-word}"
    rounded: "{rounded.none}"
    padding: "2px 8px"
  trust-tag-stale:
    backgroundColor: "{colors.stale-tint}"
    textColor: "{colors.stale-word}"
    rounded: "{rounded.none}"
    padding: "2px 8px"
---

# Design System: better-answers

## Overview

**Creative North Star: "Issued Drawing"**

The operator chose the Issued Drawing world on 6 November 2026. Each concept is drawn like an engineering drawing. A title block beside the concept states who generated it, who checked it, the current check and the review date. The page is a pale grey field with a faint grid.

The app is a tool. People read, check and copy knowledge in it every day. Density is high and decoration is low. Hairlines divide content. Corners are square. One blue marks what a person can act on. Colour also marks trust, and the trust word always says the same thing as text.

The tokens live in `apps/web/src/styles/`. This file records them. When the two differ, the stylesheets win and this file is out of date.

**Key Characteristics:**

- A faint 32px grid on the page, kept off the reading column.
- Square corners on every object except the spinner, the radio and the avatar.
- Hairlines, not shadows, divide content.
- One interactive blue, ink blue.
- Trust as a pale tint and a dark word, never colour alone.
- Geist for words. Geist Mono for references, source numbers and the dates in the title block's cells.
- Text selection, scrollbars and link underlines take their colours from the tokens.

## Colors

A cool grey sheet with near-black ink, one blue for actions, and three trust tints.

### Primary

- **Ink blue** (`ink-blue`): links, the focus ring's outer edge, the primary button and the selected state. Nothing else is blue.
- **Deep ink blue** (`ink-blue-deep`): the hover state of links and the primary button.
- **Pale ink blue** (`ink-blue-pale`): the selected row or item. **Ring blue** (`ink-blue-ring`) is the pale inner band of the focus ring.

### Neutral

- **Page** (`page`): the page and the shell band.
- **Card** (`card`): cards, the title block, fields and menus.
- **Sunken** (`sunken`) and **Inset** (`inset`): the menu, hover fills, code blocks and the unverified tag.
- **Hairlines** (`hairline-subtle`, `hairline`, `hairline-strong`): dividers, card edges and table rules.
- **Control edge** (`control-edge`): the border of a field, a checkbox or a radio. It keeps 3:1 contrast in both themes.
- **Ink** (`ink`): titles, headings and the title block's frame. **Body ink** (`body-ink`): running text. **Secondary ink** (`secondary-ink`): descriptions, labels and counts. **Muted ink** (`muted-ink`): registration marks and the faintest metadata.

### Trust

- **Verified** (`verified-tint`, `verified-word`): Verified by a person and Verified automatically.
- **Stale** (`stale-tint`, `stale-word`): Changed since verified and Out of date.
- **Draft** (`draft-tint`, `draft-word`): Draft.
- **Restricted** (`restricted-tint`, `restricted-word`): restricted sensitivity.
- Unverified and Deprecated use the grey `inset` tint with `secondary-ink`.

### Dark theme

`[data-theme="dark"]` on `<html>` swaps the semantic tokens in `semantic.css`. The page is `#0b0c0e`. Cards are `#121417`. Links are `#93aafc`. The primary fill is `#3f62ea`. Trust tints become 16 to 18% washes of the same hue with a light word.

### Named Rules

**The one blue rule.** Ink blue marks only links, focus and the primary action. A fill that is not an action uses ink or grey.

**The word first rule.** A trust colour only tints a tag or a cell whose word already states the trust. Colour never carries trust alone.

## Typography

**Body font:** Geist (self-hosted through `@fontsource-variable/geist`), with the platform sans as fallback.
**Mono font:** Geist Mono (`@fontsource-variable/geist-mono`).

**Character:** Geist is a plain sans-serif. It stays legible at 11px. Geist Mono sets references, source numbers, page numbers and the dates in the title block's cells. The trust word's date, a trust tag's date and the dates in lists are in Geist.

Geist is a deliberate choice. The detector's `overused-font` rule names it, and `.impeccable/config.json` records the exception with its reason.

### Hierarchy

- **Title** (600, 30px, 1.15, -0.022em): the one page title, `h1`. One per page.
- **Section** (600, 20px, 1.3): `h2` by default.
- **Small heading** (600, 16px, 1.3): the concept page's Sources and Links, and headings inside a guide.
- **Prose** (400, 16px, 1.6): a concept's body and a page description. The body's lines stop at `--measure-reading` (34em, about 75 characters of Geist).
- **Body** (400, 14px, 1.45): the interface: tables, lists, the title block's values, menus.
- **Meta** (400, 13px): buttons, the type and collection line, counts and timestamps beside a row.
- **Label** (500, 11px, 0.06em, uppercase): a title block cell's label and a menu group's name. Nothing else.
- **Reference** (Geist Mono 400, 12px to 13px): a concept's reference, generator names, source numbers, page numbers, and the dates in the Generated by, Last verified, Earlier verifications and Review by cells.

### Named Rules

**The measure rule.** Running text stops at about 75 characters. Use `--measure-reading` (34em).

**The label rule.** Uppercase is only for the label of a title block cell or a menu group. A heading is never uppercase, and nothing sits above a heading as a label.

## Layout

- **Shell.** A 48px band across the top. Below it, a 56px rail of areas and a 248px menu. The work area holds the page.
- **Grid.** The work area carries a 32px grid of 1px lines at 5% ink (`[data-grid-pattern]`). On a page with a reading column (`data-grid-mask="reading"`), a band of page colour covers the grid under the first 576px of the work area and fades out by 640px. Below 1248px of viewport the mask covers the whole width.
- **Concept page.** A reading column of up to 544px (17 grid modules) and a 352px title block on the right, 48px apart (64px from 1056px of page width). The title block starts level with the title. Below 880px of page width the title block stacks under the header, before the body.
- **Spacing.** Steps of 4px: 4, 8, 12, 16, 24, 32, 48, 64. Dense controls also use 2px and 6px. Lists use 10px row padding with a hairline under each row.
- **Mobile.** At 390px the rail and menu fold into the band, the title block stacks, and nothing scrolls sideways.

## Elevation & Depth

Hairlines and tint divide content. The outline button and the field carry `--shadow-xs`, a 1px shadow at 5% ink. Menus, popovers and dialogs float over the page and carry `--shadow-md` to `--shadow-dialog`.

**The flat sheet rule.** A card, a title block or a table casts no shadow. It is a hairline box on the sheet.

## Shapes

Every corner is square: each `--radius-*` step is 0, and a utility layer squares any kit `rounded-*` class. Only the spinner ring, the radio and the avatar stay round.

**Registration marks.** `data-marks` draws a small "+" (7px arms, 1px) centred on each corner of an object that registers to the grid: the title block, the search card, the sign-in card and the primary button. Inside a marked object nothing is marked again.

## Components

### Buttons

- **Shape:** square, 32px high, 13px medium text.
- **Primary:** ink blue fill, white text, registration marks. One per page at most.
- **Outline:** page fill, hairline border, body ink. Hover fills with sunken grey.
- **Link:** ink blue text, underline on hover.
- **Focus:** a 2px pale ring with a 1px ink blue edge (`--focus-ring`), on every control.

### Trust tag

- **Style:** a square tag with a 1px border, a 50-level tint, a bold icon and the trust word in the 700-level colour.
- **Use:** search results, All Knowledge and guides. The concept page shows the same word, larger and without a border, in the title block's first cell.

### Cards and containers

- **Corners:** square. **Background:** card white. **Border:** 1px hairline. **Shadow:** none.

### Inputs

- **Style:** 36px high, page fill, 1px control edge, square.
- **Focus:** the focus ring.

### Navigation

- **Rail:** the four areas as icons, the current area on an inset fill.
- **Menu:** 14px items with an icon, the current page on an inset fill. Group names use the label style.

### Title block

The signature of the system. A 352px card with a 1px ink frame and registration marks. A two-column grid of cells divided by hairlines. Each cell has a label and a 14px medium value.

- The first cell is the trust word, full width, on its trust tint, with the date beside it.
- Then the reference in Geist Mono, generated by, last verified, earlier verifications, review by, owner, sources and used in.
- Each fact shows once. Last verified appears only when the trust word is a status, which hides who verified and when. Earlier verifications appears only when there are earlier ones. The status is the trust word. The sources count is on the Sources heading, and a concept with no sources says None in a Sources cell.
- Earlier verifications lists the verifications before the latest. OKF v0.2 records no revision number. The block has no revision cell.
- A review date that has passed takes the stale word colour.
- A cell with nothing to show reads its word from `EMPTY_WORDS` in `apps/web/src/shared/knowledge/concept-words.ts`, one word for each empty state. A half-width cell with no partner takes the full width.

## Do's and Don'ts

### Do:

- **Do** write each trust state as its word, from the closed set in `PRODUCT.md`.
- **Do** keep ink blue for links, focus and the primary action.
- **Do** set references, source numbers and the title block's cell dates in Geist Mono.
- **Do** divide content with 1px hairlines.
- **Do** stop prose at `--measure-reading`.
- **Do** take every value from the tokens in `apps/web/src/styles/`.

### Don't:

- **Don't** round a corner other than the spinner, the radio or the avatar.
- **Don't** cast a shadow from a card, a title block or a table.
- **Don't** add a second accent colour.
- **Don't** let colour carry trust without its word.
- **Don't** put a small uppercase label above a heading.
- **Don't** add an animation beyond the four in `keyframes.css`.
