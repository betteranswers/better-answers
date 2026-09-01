One-line: a dot field that marks a bounded area as empty — `@magicui/dot-pattern` at the blueprint tokens.

```jsx
<Frame padding="0" style={{position:"relative",minHeight:180}}>
  <DotPattern fade />
  <EmptyState title="No sources connected." action={<Button variant="accent">Connect a source</Button>} />
</Frame>
```

The Frame already carries the registration marks, so the button inside it takes the unmarked `accent` fill — one marked level per stack.

Semantic, not decorative: dots mean *nothing is here yet*. Empty states, drop zones, the unbuilt region of a diagram. Never behind text, never behind a populated card, never as a page background — the page gets `GridPattern`.
