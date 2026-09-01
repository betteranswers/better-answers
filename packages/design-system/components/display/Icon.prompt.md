One-line: the only icon primitive — one Phosphor glyph at 16px, `currentColor`, never decorative.

```jsx
<Icon name="magnifying-glass" />
<Icon name="check-circle" size={18} weight="bold" />
<IconButton icon={<Icon name="copy" />} label="Copy the answer" />
```

**Phosphor.** `@phosphor-icons/react` in the application; `@phosphor-icons/web` on a static page — same kebab-case names, so screens port without glyph changes. Load the weights you use before React mounts:

```html
<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css">
<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/bold/style.css">
```

Regular everywhere; bold for an active nav item; fill only inside a solid accent chip. Never duotone, never a second family, never emoji. An icon accompanies a label or carries an `aria-label` on its control — it never carries meaning alone ([A11Y1]).

Glyphs in use: `magnifying-glass`, `tray`, `database`, `graph`, `question`, `users`, `pulse`, `book-open`, `chat-text`, `copy`, `flag`, `check-circle`, `warning`, `sliders-horizontal`, `funnel`, `plus`, `download-simple`, `clock-counter-clockwise`, `keyboard`, `arrow-square-out`.
