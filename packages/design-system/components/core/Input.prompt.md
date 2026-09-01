One-line: the standard text field — label above, hint or error below, hairline border that turns ink-blue with a two-ring focus.

```jsx
<Input label="Shelf life" hint="Blank means none." placeholder="12 months" />
<Input size="sm" prefix={<Icon name="search" />} placeholder="Search concepts" />
<Input label="Workspace" error="A workspace with this name already exists." />
```

Errors are full sentences with a full stop. Never put a required marker in the label — mark the optional ones.
