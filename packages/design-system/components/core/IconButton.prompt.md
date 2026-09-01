One-line: an icon-only control that always carries an accessible name; use in toolbars, row ends and panel headers, never as the primary action of a view.

```jsx
<IconButton label="Copy answer"><Icon name="copy" /></IconButton>
<IconButton label="Filter" variant="outline" active={open}><Icon name="sliders-horizontal" /></IconButton>
```

24/28/32px. `ghost` by default; `outline` when it sits alone against a page rather than inside a group.
