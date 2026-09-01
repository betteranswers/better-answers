One-line: the dense review table behind every Control Centre screen — uppercase micro headers, hairline rows, hover tint, optional select-then-command.

```jsx
<DataTable selectable selected={sel} onSelect={setSel}
  columns={[
    {key:"title", header:"Concept"},
    {key:"kind", header:"Kind", render:r=><Tag size="sm">{r.kind}</Tag>},
    {key:"trust", header:"Trust", render:r=><TrustTag size="sm" state={r.state} by={r.by} at={r.at} />},
    {key:"owner", header:"Owner", align:"right"}
  ]}
  rows={rows}/>
```

Numbers right-aligned and tabular. No zebra striping, no vertical rules.
