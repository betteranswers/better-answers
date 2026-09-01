One-line: the optimistic confirmation — the act already applied ([UX2]); the toast reports it and offers the undo.

```jsx
<Toast message="12 concepts accepted." detail="Commit 4f1c9ad · Knowledge" undoLabel="Undo" onUndo={undo} />
```

Never use a toast for an error a person must act on — that is a NotificationBanner on the surface itself.
