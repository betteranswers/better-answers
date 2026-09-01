import React from "react";

export function Details({ summary, defaultOpen = false, children, style, ...rest }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div style={{ fontFamily: "var(--font-sans)", ...style }} {...rest}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "5px",
          border: "none",
          background: "none",
          padding: 0,
          color: "var(--text-link)",
          fontFamily: "inherit",
          fontSize: "var(--text-xs)",
          fontWeight: "var(--weight-medium)",
          cursor: "pointer",
          letterSpacing: "var(--tracking-body)",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            fontSize: "8px",
            transform: open ? "rotate(90deg)" : "none",
            transition: "transform var(--duration-fast) var(--ease-standard)",
          }}
        >
          ▶
        </span>
        {summary}
      </button>
      {open && (
        <div
          style={{
            marginTop: "8px",
            paddingLeft: "13px",
            borderLeft: "1px solid var(--border-default)",
            fontSize: "var(--text-base)",
            lineHeight: "var(--leading-normal)",
            color: "var(--text-secondary)",
            animation: "ba-fade var(--duration-fast) var(--ease-standard)",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
