One-line: view switching within one surface — a 1.5px underline on the selected tab, counts in a quieter grey.

```jsx
<Tabs value={tab} onChange={setTab} tabs={[
  {value:"brief", label:"Brief"},
  {value:"detail", label:"Detail"},
  {value:"coverage", label:"Coverage", count:4}
]}/>
```

A guide's layers (assembled / quoted) are Tabs; Control Centre's six screens are the SideNav.
