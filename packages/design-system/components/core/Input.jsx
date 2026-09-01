import React from "react";

const SIZES = {
  sm: { h: "28px", fs: "var(--text-xs)", px: "8px" },
  md: { h: "32px", fs: "var(--text-base)", px: "10px" },
  lg: { h: "40px", fs: "var(--text-md)", px: "12px" },
};

export function Input({ label, hint, error, size = "md", prefix, suffix, id, style, ...rest }) {
  const [focus, setFocus] = React.useState(false);
  const s = SIZES[size] || SIZES.md;
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
            letterSpacing: "var(--tracking-body)",
          }}
        >
          {label}
        </label>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          height: s.h,
          padding: `0 ${s.px}`,
          background: "var(--surface-card)",
          borderRadius: "var(--radius-md)",
          border: `1px solid ${error ? "var(--red-600)" : focus ? "var(--border-focus)" : "var(--border-default)"}`,
          boxShadow: focus ? "var(--focus-ring)" : "var(--shadow-xs)",
          transition: "var(--transition-control)",
        }}
      >
        {prefix && (
          <span style={{ display: "flex", color: "var(--text-faint)", flexShrink: 0 }}>
            {prefix}
          </span>
        )}
        <input
          id={fid}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={{
            flex: 1,
            minWidth: 0,
            border: "none",
            outline: "none",
            background: "transparent",
            fontFamily: "inherit",
            fontSize: s.fs,
            color: "var(--text-primary)",
            letterSpacing: "var(--tracking-body)",
          }}
          {...rest}
        />
        {suffix && (
          <span
            style={{
              display: "flex",
              color: "var(--text-faint)",
              flexShrink: 0,
              fontSize: "var(--text-xs)",
            }}
          >
            {suffix}
          </span>
        )}
      </div>
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
