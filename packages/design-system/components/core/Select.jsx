import React from "react";

const SIZES = { sm: "28px", md: "32px", lg: "40px" };

export function Select({ label, hint, options = [], size = "md", id, style, ...rest }) {
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
      <div style={{ position: "relative", display: "flex" }}>
        <select
          id={fid}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={{
            appearance: "none",
            width: "100%",
            height: SIZES[size] || SIZES.md,
            padding: "0 28px 0 10px",
            background: "var(--surface-card)",
            borderRadius: "var(--radius-md)",
            border: `1px solid ${focus ? "var(--border-focus)" : "var(--border-default)"}`,
            boxShadow: focus ? "var(--focus-ring)" : "var(--shadow-xs)",
            outline: "none",
            fontFamily: "inherit",
            fontSize: size === "sm" ? "var(--text-xs)" : "var(--text-base)",
            color: "var(--text-primary)",
            cursor: "pointer",
            transition: "var(--transition-control)",
          }}
          {...rest}
        >
          {options.map((o) => {
            const v = typeof o === "string" ? o : o.value,
              l = typeof o === "string" ? o : o.label;
            return (
              <option key={v} value={v}>
                {l}
              </option>
            );
          })}
        </select>
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            right: "9px",
            top: "50%",
            transform: "translateY(-50%)",
            pointerEvents: "none",
            color: "var(--text-faint)",
            fontSize: "9px",
            lineHeight: 1,
          }}
        >
          ▼
        </span>
      </div>
      {hint && (
        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{hint}</span>
      )}
    </div>
  );
}
