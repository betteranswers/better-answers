One-line: the blueprint object — a transparent, square-cornered line drawing with "+" registration marks on its corners.

```jsx
<Frame label="Coverage" note="18 of 24 concepts">
  <CoverageBar included={18} expected={24} />
</Frame>

<Frame marks={false} surface="var(--surface-sunken)" padding="0">…</Frame>
<RegMarks color="var(--accent-600)" corners="tl br" />
```

**Where a "+" is allowed** — a mark registers a *board-level* object against the grid:

1. a page region or module frame,
2. a figure, diagram or specimen,
3. a card that is a direct child of the page grid,
4. the primary button (the one solid object),
5. an empty state or drop zone.

**Never**: inputs, selects, textareas, tags, trust tags, badges, table rows or cells, nav items, menu items, tooltips, toasts, anything under 32px tall, and anything inside a parent that already carries marks. A committing action *repeated per row* uses Button's unmarked `accent` fill, not `primary`. **One marked level per stack.** Budget at most three marked objects per screen — if everything is registered, nothing is.

A frame's parent must not clip overflow: marks sit centred *on* the corner, half outside the border.
