One-line: the product's only button — use it for every action, and state the consequence in the label rather than in a tooltip ([UX1]).

```jsx
<Button variant="primary" size="md" onClick={accept}>Accept 12 concepts</Button>
<Button variant="accent" size="sm">Review</Button>
<Button variant="secondary" iconLeft={<Icon name="funnel" />}>Filter</Button>
<Button variant="ghost" size="sm">Decline</Button>
```

`primary` is the one solid object on the board: accent fill, square corners, "+" registration marks. **One per view.** A committing action repeated per row uses `accent` — the same fill without marks — so the register does not multiply down a list.

Variants: `primary` (near-black fill — the committing action), `secondary` (hairline, the default), `accent` (ink blue — reserved for gates: accept, publish, save as an Answer), `ghost` (toolbars and table rows), `danger` (red label on a hairline shell, never a red fill). Sizes 26/32/40px. Labels are sentence case, verb-first, never "Submit".
