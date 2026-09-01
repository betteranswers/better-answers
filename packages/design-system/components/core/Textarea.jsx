import React from "react";

export function Textarea({ label, hint, error, rows = 4, id, style, ...rest }) {
  const [focus, setFocus] = React.useState(false);
  const fid = id || React.useId();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        fontFamily: "var(--font-sans)",
        ...style,
      }}
    >
      {label && (
        <label
          htmlFor={fid}
          style={{
            fontSize: "var(--text-xs)",
            fontWeight: "var(--weight-medium)",
            color: "var(--text-body)",
          }}
        >
          {label}
        </label>
      )}
      <textarea
        id={fid}
        rows={rows}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          padding: "9px 10px",
          background: "var(--surface-card)",
          borderRadius: "var(--radius-md)",
          border: `1px solid ${error ? "var(--red-600)" : focus ? "var(--border-focus)" : "var(--border-default)"}`,
          boxShadow: focus ? "var(--focus-ring)" : "var(--shadow-xs)",
          outline: "none",
          resize: "vertical",
          fontFamily: "inherit",
          fontSize: "var(--text-base)",
          lineHeight: "var(--leading-normal)",
          color: "var(--text-primary)",
          transition: "var(--transition-control)",
        }}
        {...rest}
      />
      {(error || hint) && (
        <span
          style={{
            fontSize: "var(--text-xs)",
            color: error ? "var(--status-danger-fg)" : "var(--text-muted)",
          }}
        >
          {error || hint}
        </span>
      )}
    </div>
  );
}
