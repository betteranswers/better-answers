# Registry components in `apps/web/src/shared/ui/`

ADR 0033 takes shadcn, Kibo UI and Vercel AI Elements as **source into this repository**, and
says a registry component carries the same notice obligation as any lift (`[LIFT3]`, ADR 0027).
This file is that notice. It covers every file under this directory; the tokens, the stylesheet
and the Tailwind bridge these components read are `packages/design-system`'s and are ours.

Installed **3 September 2026** with `shadcn@4.20.1` and `ai-elements@1.9.0`. A shadcn registry
item carries no version of its own, so the pin is the CLI, the registry URL and the date
(`[DEPS1]`); `apps/web/components.json` holds the URLs so a refresh lands in the same places.

## What came from where

| Files | Upstream | Registry | Licence |
| --- | --- | --- | --- |
| `badge.tsx`, `button.tsx`, `carousel.tsx`, `collapsible.tsx`, `command.tsx`, `dialog.tsx`, `dropdown-menu.tsx`, `hover-card.tsx`, `popover.tsx`, `select.tsx`, `table.tsx`, `tabs.tsx` | [shadcn-ui/ui](https://github.com/shadcn-ui/ui) | `https://ui.shadcn.com/r/{name}.json` | MIT |
| `kibo-ui/combobox.tsx`, `kibo-ui/snippet.tsx` | [haydenbleasel/kibo](https://github.com/haydenbleasel/kibo) | `https://www.kibo-ui.com/r/{name}.json` | MIT |
| `ai-elements/sources.tsx`, `ai-elements/inline-citation.tsx` | [vercel/ai-elements](https://github.com/vercel/ai-elements) | `https://registry.ai-sdk.dev/{name}.json` | Apache-2.0 |

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

Everything else is upstream's, unedited. Their behaviour — keyboard handling, focus, ARIA
wiring, virtualisation — is theirs by ADR 0033; the screens that use them carry the WCAG 2.2 AA
line (`[A11Y1]`) and are tested with a keyboard and a screen reader.

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
