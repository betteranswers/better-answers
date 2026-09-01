import React from "react";

export function Citation({
  marker,
  concept,
  source,
  locator,
  passage,
  trust,
  defaultOpen = false,
  style,
  ...rest
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div
      style={{
        fontFamily: "var(--font-sans)",
        borderLeft: "2px solid var(--border-default)",
        paddingLeft: "12px",
        ...style,
      }}
      {...rest}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          width: "100%",
          border: "none",
          background: "none",
          padding: 0,
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "inherit",
        }}
      >
        {marker != null && (
          <span
            style={{
              flexShrink: 0,
              minWidth: "18px",
              height: "18px",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "var(--radius-xs)",
              background: "var(--surface-inset)",
              color: "var(--text-secondary)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-2xs)",
            }}
          >
            {marker}
          </span>
        )}
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: "var(--text-sm)",
            fontWeight: "var(--weight-medium)",
            color: "var(--text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {concept}
        </span>
        {trust}
      </button>
      <p
        style={{
          margin: "3px 0 0",
          paddingLeft: marker != null ? "26px" : 0,
          fontSize: "var(--text-xs)",
          color: "var(--text-muted)",
        }}
      >
        {source}
        {locator ? " · " + locator : ""}
      </p>
      {open && passage && (
        <blockquote
          style={{
            margin: "8px 0 0",
            marginLeft: marker != null ? "26px" : 0,
            padding: "8px 10px",
            background: "var(--surface-sunken)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm)",
            fontSize: "var(--text-sm)",
            lineHeight: "var(--leading-normal)",
            color: "var(--text-body)",
            fontStyle: "normal",
            animation: "ba-fade var(--duration-fast) var(--ease-standard)",
          }}
        >
          “{passage}”
        </blockquote>
      )}
    </div>
  );
}
