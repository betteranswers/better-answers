import React from "react";

export function SummaryList({ items = [], dense = false, style, ...rest }) {
  return (
    <dl
      style={{
        margin: 0,
        display: "grid",
        gridTemplateColumns: "minmax(120px,190px) 1fr auto",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-base)",
        ...style,
      }}
      {...rest}
    >
      {items.map((it, i) => (
        <React.Fragment key={it.term + i}>
          <dt
            style={{
              padding: dense ? "7px 0" : "10px 0",
              borderTop: i ? "1px solid var(--border-subtle)" : "none",
              color: "var(--text-muted)",
              fontSize: "var(--text-xs)",
              letterSpacing: "var(--tracking-body)",
            }}
          >
            {it.term}
          </dt>
          <dd
            style={{
              margin: 0,
              padding: dense ? "7px 0" : "10px 0",
              borderTop: i ? "1px solid var(--border-subtle)" : "none",
              color: "var(--text-body)",
            }}
          >
            {it.description}
          </dd>
          <dd
            style={{
              margin: 0,
              padding: dense ? "7px 0" : "10px 0",
              borderTop: i ? "1px solid var(--border-subtle)" : "none",
              textAlign: "right",
            }}
          >
            {it.action || null}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
