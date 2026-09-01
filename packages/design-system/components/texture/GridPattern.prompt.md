One-line: the modular grid made visible — `@magicui/grid-pattern` at the blueprint tokens, one per screen, behind everything.

```jsx
<div style={{position:"relative"}}>
  <GridPattern width={32} height={32} />
  <main>…</main>
</div>
```

The page substrate only. It is the same 32px module the layout is set on, so the grid and the content agree — never a decorative grid at a different pitch. Not inside a card, not inside a dialog, not behind reader prose at full strength (drop `--grid-line` to 3% or mask it away). `strokeDasharray="2 3"` gives the plotted variant, reserved for a figure's working area.
