One-line: the 248px left rail — a sunken surface, hairline right edge, grouped items, counts trailing.

```jsx
<SideNav value={screen} onChange={setScreen}
  header={<Wordmark />}
  sections={[
    {items:[{value:"ask",label:"Ask",icon:<Icon name="sparkle"/>},{value:"search",label:"Search",icon:<Icon name="magnifying-glass"/>}]},
    {label:"Control Centre", items:[{value:"suggestions",label:"Suggestions",icon:<Icon name="tray"/>,trailing:<Badge count={12}/>}]}
  ]}/>
```
