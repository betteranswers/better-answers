---
title: "A non-modal Radix sheet still loops Tab inside itself, so the page behind it leaves the tab order"
date: 2026-10-10
category: logic-errors
module: apps/web
problem_type: logic_error
component: web
symptoms:
  - "With the evidence panel open beside Search, Tab from its Close button landed on Close again, and Shift+Tab did the same"
  - "Only Escape left the panel, which closed it, so a keyboard reader could not keep a passage open and move on through the list as a mouse reader could"
  - "Single-key page keystrokes (`/`, `m`) did nothing from inside the panel, because the page ignores keys pressed inside a `role=\"dialog\"`"
root_cause: wrong_api
resolution_type: code_fix
severity: medium
framework_version: "@radix-ui/react-dialog 1.1.23, @radix-ui/react-focus-scope 1.1.16, @radix-ui/react-slot 1.3.3"
retire_when: "Radix Dialog stops passing `loop: true` to FocusScope when `modal` is false; check `DialogContentImpl` in @radix-ui/react-dialog's dist/index.mjs"
tags:
  - radix
  - dialog
  - sheet
  - non-modal
  - focus-scope
  - tab-order
  - keyboard
  - wcag
---

# A non-modal Radix sheet still loops Tab inside itself, so the page behind it leaves the tab order

## Problem

The plan's evidence panel (KTD10 in `docs/plans/2026-10-09-1344-feat-s2a-search-and-concept-page-plan.md`) is a sheet opened beside a page that "stays interactive and in the tab order". It was built as a Radix Dialog with `modal={false}` and no overlay (`SheetContent`'s `overlay={false}` in `apps/web/src/shared/ui/sheet.tsx`). The pointer could reach the page behind it, but the keyboard could not: Tab never left the panel.

## Symptoms

- With the panel open, Tab from its last control came back to that control. Shift+Tab from its first control did the same.
- Escape was the only way out, and Escape closes the panel.
- The page's single-key keystrokes do nothing inside the panel, because the keystroke layer ignores a key pressed inside `[role="dialog"]` (`OWNED_ELSEWHERE` in `apps/web/src/shared/keystrokes.tsx`). So no shortcut got the reader out either.

## What Didn't Work

- **Trusting `modal={false}` to release focus.** It turns off the focus *trap*, the scrim, and `aria-hidden` on the rest of the page. It does not turn off the *loop*. Radix's `DialogContentImpl` passes `loop: true` and `trapped: trapFocus` to `FocusScope` whatever `modal` is (`@radix-ui/react-dialog` 1.1.23, `dist/index.mjs:223-224`). `FocusScope`'s `handleKeyDown` returns early when both are false (`@radix-ui/react-focus-scope` 1.1.16, `dist/index.mjs:109`), or when the scope is paused (`:110`). With `loop` set, it wraps Tab on the last tabbable and Shift+Tab on the first (`:120`, `:123`), trapped or not.
- **Proving "non-modal" with the pointer.** The first spec clicked the search box with the panel open and saw the panel stay open. That proved the page was live to a mouse and nothing about the keyboard. The review's frontend-races lens found the loop by reading the Radix source, and the validator confirmed it from the installed version.
- **A plain `<aside>` instead of the dialog.** It would have given natural tab order. But it departs from KTD10's named mechanism (a variant of `sheet.tsx`), so it was held back while a fix inside the KTD was tried first. That fix worked.

## Solution

Handle Tab on `SheetContent` itself, and on Tab off either edge, move focus to the control that opened the panel (`tabsOff` and the `onKeyDown` in `apps/web/src/features/knowledge/evidence-panel.tsx`):

```tsx
const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Radix loops Tab inside a dialog that is not modal too, so Tab off either end leaves it. */
const tabsOff = (event: KeyPress<HTMLElement>): boolean => {
  if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return false;
  const tabbable = [...event.currentTarget.querySelectorAll<HTMLElement>(TABBABLE)];
  const at = document.activeElement;
  if (event.shiftKey) return at === tabbable[0] || !tabbable.some((each) => each === at);
  return at === tabbable.at(-1);
};

<SheetContent
  overlay={false}
  onKeyDown={(event) => {
    if (!tabsOff(event)) return;
    event.preventDefault();
    returnFocus(opened); // the opener, by its id
  }}
/>
```

Shift+Tab counts as leaving from a non-tabbable element as well. The heading the panel focuses on open has `tabIndex={-1}`, and the browser would otherwise send that Shift+Tab to whatever precedes the portal at the end of `<body>`.

Two parts make the panel usable from the keyboard as well as reachable:

- **A way back in.** The panel is portalled to the end of `<body>`, so Tab cannot reach it from the list. A reader who Tabs off the panel continues from its opener, and enters the panel again by pressing the opener, which moves focus back to the panel's heading. `Opened.pressed` counts presses, and `PanelBody` is keyed by it, so a repeat press remounts the heading, and the heading's mount ref focuses it.
- **Room beside the page.** A fixed 28rem sheet covers the whole content column at the shell's own `md` breakpoint: 768 px, less the 56 px rail, the 248 px menu and `md:px-8`, leaves about 400 px. So the panel opens beside the page only from `xl`, and inline under its match below that. The stylesheet holds that breakpoint as `--room-beside` (`apps/web/src/index.css`), and `useRoomBeside` (`apps/web/src/shared/wide-layout.ts`) reads it, as `useWideLayout` reads `--shell-wide`.

The proof is `apps/web/e2e/knowledge-search.spec.ts`, "hands Tab from the open panel back to its opener". With the handler disabled it failed at "Tab off the panel did not reach the page". With the handler in place it passes.

## Why This Works

The handler runs before `FocusScope`'s. `FocusScope` renders `asChild`, so Radix's `Slot` merges its `onKeyDown` with the child's, and `mergeProps` calls the child's handler first and the slot's second (`@radix-ui/react-slot` 1.3.3, `dist/index.mjs:81-93`). `SheetContent`'s props reach that child. So the panel's handler has already moved focus by the time `FocusScope` reads `document.activeElement`. Focus is then on the opener, outside the container, so neither of `FocusScope`'s wrap branches matches and it does nothing. `event.preventDefault()` stops the browser's own Tab move, which would otherwise run after the handlers.

## Prevention

- **Test a non-modal dialog by keyboard.** A spec that proves the page behind a panel is live needs a Tab-out step: Tab from the panel's last control, and expect focus on the page with the panel still visible. Clicking the page proves only the pointer half.
- **`modal={false}` is not "in the page's tab order".** Any Radix Dialog drawn beside a page needs a Tab handler like this one, or a plain region in the DOM after its opener. That includes a future side sheet on another page and U12's concept panel, which reuses this one.
- **Focus back on close, but only from the panel.** `onCloseAutoFocus` also fires when the content unmounts because state changed, in a `setTimeout` after unmount (`@radix-ui/react-focus-scope` 1.1.16, `dist/index.mjs:94`). A new search closes the panel that way. The handler moves focus to the opener only when `document.activeElement` is `body`, which is where focus is when it was inside the removed panel. Otherwise it would pull focus out of the search box mid-typing. The spec types a new query with the panel open and expects the box to keep focus.
- **Measure a side sheet against the narrowest layout that draws it.** The width to check is the content column left after the rail, the menu and the padding, not the viewport. The suite runs at 1280 and 320 px, so the band below `xl` has a spec of its own (the inline panel at 1024 px).

## Related Issues

- `docs/solutions/architecture-patterns/adr-0033-ui-kit-is-tailwind-v4.md`: the registries own keyboard and focus behaviour. This is a case where the registry's default contradicts the variant the platform needs, and the platform overrides it at the call site, not in the vendored file.
- `docs/solutions/architecture-patterns/adr-0042-product-ships-accessibility-statement.md`: the WCAG 2.2 AA bar and its keyboard test. This doc reads the 28rem sheet covering the list at `md` as a case of 2.4.11 Focus Not Obscured; the ADR does not name that criterion.
- The plan's KTD10 carries the rule, and U12's approach draws the concept page's panel and its keyboard path by it.
