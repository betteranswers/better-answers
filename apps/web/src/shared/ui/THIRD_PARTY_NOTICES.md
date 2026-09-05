# Registry components in `apps/web/src/shared/ui/`

ADR 0033 takes shadcn, Kibo UI and Vercel AI Elements as **source into this repository**, and
says a registry component carries the same notice obligation as any lift (`[LIFT3]`, ADR 0027).
This file is that notice. It covers every file under this directory; the tokens, the stylesheet
and the Tailwind bridge these components read are `packages/design-system`'s and are ours.

Installed **3 September 2026** with `shadcn@4.20.1` and `ai-elements@1.9.0`. A shadcn registry
item carries no version of its own, so the pin is the CLI, the registry URL and the date
(`[DEPS1]`); `apps/web/components.json` holds the URLs so a refresh lands in the same places.

T-037 added two more items on the same day with the same CLI — `input` and `label`.

This file records vendored source only. The npm packages those items stand on are ordinary
dependencies with lockfile entries; their versions live in `apps/web/package.json` and the
lockfile, which is where a reader reads them and where Renovate moves them.

## Provenance, item by item

Two digests per component, sha256 truncated to 16 hex characters, both taken 3 September 2026.
The **item** digest is the registry's JSON as it served it that day: a refresh whose item digest
is unchanged has nothing to bring. The **file** digest is the source as it sits here, *after*
the arrival edits below: it is what tells a reader whether a file has drifted since, and it is
the one to recompute before a refresh so the edits can be reapplied deliberately rather than
discovered missing. `shasum -a 256 <file> | cut -c1-16` reproduces the second column.

Upstream repositories: [shadcn-ui/ui](https://github.com/shadcn-ui/ui) (MIT),
[haydenbleasel/kibo](https://github.com/haydenbleasel/kibo) (MIT),
[vercel/ai-elements](https://github.com/vercel/ai-elements) (Apache-2.0). A shadcn registry item
carries no commit or version of its own — this is the whole reason the item digest stands in for
one — so there is no upstream commit to record, and the CLI version and the date are the rest of
the pin (`[DEPS1]`).

| File | Registry item | Item digest | File digest |
| --- | --- | --- | --- |
| `badge.tsx` | https://ui.shadcn.com/r/styles/new-york/badge.json | `ce3f01e6d6785477` | `051518194cec3127` |
| `button.tsx` | https://ui.shadcn.com/r/styles/new-york/button.json | `4d8f39c3bd25e630` | `76bfc0a14e9c395d` |
| `carousel.tsx` | https://ui.shadcn.com/r/styles/new-york/carousel.json | `07c286e6b8c6a125` | `8db57d96badd03aa` |
| `collapsible.tsx` | https://ui.shadcn.com/r/styles/new-york/collapsible.json | `9e935a82f4d846cc` | `f3ce568d1ede383d` |
| `command.tsx` | https://ui.shadcn.com/r/styles/new-york/command.json | `b2800b32e6dbfb40` | `aa5236bf5e2680fd` |
| `dialog.tsx` | https://ui.shadcn.com/r/styles/new-york/dialog.json | `e240f8eaa9e9e626` | `cdb85fcea315ed0d` |
| `dropdown-menu.tsx` | https://ui.shadcn.com/r/styles/new-york/dropdown-menu.json | `dbd4c0a23be34f27` | `4b09b5f51def7d8e` |
| `hover-card.tsx` | https://ui.shadcn.com/r/styles/new-york/hover-card.json | `cd66337682527d0f` | `e4af8adfc11ca89e` |
| `popover.tsx` | https://ui.shadcn.com/r/styles/new-york/popover.json | `112f3cc3836f6b37` | `cce1178282657cd3` |
| `select.tsx` | https://ui.shadcn.com/r/styles/new-york/select.json | `574c730b6dc8b37e` | `57dc01beab6126fd` |
| `table.tsx` | https://ui.shadcn.com/r/styles/new-york/table.json | `0cf28e873dde65e0` | `0b594ca1376c7e6f` |
| `tabs.tsx` | https://ui.shadcn.com/r/styles/new-york/tabs.json | `b608b427c8d64016` | `7729090ff447f666` |
| `kibo-ui/combobox.tsx` | https://www.kibo-ui.com/r/combobox.json | `3d4a0d9e74228a9f` | `64900867375f3091` |
| `kibo-ui/snippet.tsx` | https://www.kibo-ui.com/r/snippet.json | `eb643de82639a64e` | `fbf35ce84afabbf0` |
| `ai-elements/sources.tsx` | https://registry.ai-sdk.dev/sources.json | `a698c945798c6e79` | `e7117ede42aa02ed` |
| `ai-elements/inline-citation.tsx` | https://registry.ai-sdk.dev/inline-citation.json | `7ee8f5238d63b78f` | `618d35f1d1147d77` |
| `input.tsx` | https://ui.shadcn.com/r/styles/new-york/input.json | `4d1a3b126cc62485` | `b1b9f3d7ab813dfe` |
| `label.tsx` | https://ui.shadcn.com/r/styles/new-york/label.json | `ea924e70d496cbd6` | `ec7442bb079f9558` |

`components.json` writes `https://ui.shadcn.com/r/{name}.json` for the primitives because that is
the CLI's own default form; the table records the style-qualified URL the CLI resolves it to,
which is the one that answers with JSON when fetched by hand.

**Audited by** the T-036 builder on 3 September 2026: every file above was read before it landed,
which is what ADR 0033 means by "a registry component is reviewed before it lands". The reading
is what produced the arrival edits below, the four token corrections, the rejection of Kibo UI's
`table` (written against `@tanstack/react-table` v8 while v9 is current), and the four
how-it-is-written lint rules relaxed over this directory in `.oxlintrc.json`.

## What was changed on arrival

- Extensionless imports rewritten to explicit `.ts`/`.tsx`, which this repository's `nodenext`
  resolution requires, and the RSC `"use client"` directives removed — this is a Vite SPA.
- Kibo UI's copies of `button`, `dropdown-menu` and `table` deleted and their imports pointed at
  the shadcn originals already installed here; a second copy of the same component is drift.
- Four values moved onto the design system's tokens, because that half is the platform's
  (ADR 0033): the dialog overlay reads `--surface-scrim` and `--blur-scrim` rather than
  `bg-black/50`; the destructive badge and button read `--destructive-foreground` rather than
  `text-white`; the destructive button's dark hover is darkened to hold WCAG AA against 14px
  text; the default button and icon button sit on the 32px grid module (`--grid-module`).

T-037's arrival edits, on the two items it added:

- The same extensionless-import and `"use client"` rewrites as above.

T-042's arrival edits, made 4 September 2026 when `exactOptionalPropertyTypes` came back on
in this workspace (the flag had been off since T-036 for a reason the api's build graph owned,
and these two files were what it was quietly excusing):

- `dropdown-menu.tsx`: `DropdownMenuCheckboxItem` no longer destructures `checked` only to
  re-pass it by name — the prop rides in the spread, because an explicitly-passed
  `boolean | undefined` does not fit Radix's `checked?: CheckedState` slot under exact
  optionals.
- `kibo-ui/combobox.tsx`: the two `useControllableState` calls pass `onChange` by conditional
  spread, because the hook declares `onChange?:` without `| undefined` while `prop?:` admits
  it.

Everything else is upstream's, unedited. Their behaviour — keyboard handling, focus, ARIA
wiring, virtualisation — is theirs by ADR 0033; the screens that use them carry the WCAG 2.2 AA
line (`[A11Y1]`) and are tested with a keyboard and a screen reader.

## Refreshing this directory

1. Recompute the file digests and reconcile them with the table: any that has moved is an edit
   made since the snapshot, and it has to be carried forward deliberately.
2. Re-run the CLI (`components.json` holds the registry URLs), then reapply the arrival edits —
   the extensions, the directives, the four token corrections, and T-042's two exact-optional
   fixes. They are listed above precisely so a refresh can reapply them without rereading
   this PR.
3. Recompute both digest columns and this file's install date.
4. **The test a refresh must pass** is `apps/web`'s `check`: `oxlint` under the four relaxations
   in `.oxlintrc.json` and no others, `tsc --noEmit` (which is what catches the extensionless
   imports coming back), the component and lint-rule suites, the production build, and the
   Playwright browser suite against the api-served build. A screen that renders any of these
   components also carries its own WCAG 2.2 AA check with a keyboard and a screen reader
   (`[A11Y1]`); that check is the screen's, not this file's.

## Notice text

**MIT** (shadcn/ui, Kibo UI)

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software
> and associated documentation files (the "Software"), to deal in the Software without
> restriction, including without limitation the rights to use, copy, modify, merge, publish,
> distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
> Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
> BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
> DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Copyright (c) 2023 shadcn; Copyright (c) 2024 Hayden Bleasel.

**Apache-2.0** (Vercel AI Elements) — Copyright (c) 2025 Vercel, Inc. Licensed under the Apache
License, Version 2.0; the full text is at `LICENSE` in this repository, which is the same
licence Better Answers ships under (ADR 0027).
