One-line: what sits beside a claim so a reader can check it — concept, source, locator, and the passage one click later.

```jsx
<Citation marker="1" concept="ISO 27001 certification" source="Capability statement" locator="p.4"
  passage="Certified to ISO 27001 since March 2023, audited annually by BSI."
  trust={<TrustTag size="sm" state="checked" by="Priya Shah" at="3 March 2026" />} />
```

The marker is rendered from the include, never stored as text. Passages are quoted verbatim, in quotation marks.
