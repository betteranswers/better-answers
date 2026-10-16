# apps/web

- Meet WCAG 2.2 AA, and test it with a keyboard and a screen reader. The buyers are UK public bodies, for whom this is law. Every interactive element is a native control or has a role, a name and a focus order. Announce each outcome to assistive technology. Follow GOV.UK Design System semantics (tag, details, notification banner, warning text, summary list) without the GOV.UK brand.
- Give every common action a keystroke, and list them under `?`. Bulk work is select-then-command.
- Write page text in the glossary's reader words: the head of the thing's entry in `CONCEPTS.md`, in every heading, label, message and empty state. A place with its own address is a *page*. An entry marked `_Internal._` stays in the code. Voice, trust words and casing are in `packages/design-system/readme.md`.
