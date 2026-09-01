One-line: the decision control at a gate — each option carries its consequence before the click ([UX1]).

```jsx
<RadioGroup legend="Decision" name="promotion" value={v} onChange={setV}
  options={[
    {value:"update", label:"Update the existing Answer", description:"One governed write. You become the author."},
    {value:"new", label:"Add as a new Answer"},
    {value:"decline", label:"Decline"}
  ]}/>
```
