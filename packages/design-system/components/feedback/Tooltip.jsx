import React from "react";

export function Tooltip({ label, side = "top", children, style }) {
  const [on, setOn] = React.useState(false);
  const pos =
    side === "top"
      ? { bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)" }
      : side === "bottom"
        ? { top: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)" }
        : side === "left"
          ? { right: "calc(100% + 6px)", top: "50%", transform: "translateY(-50%)" }
          : { left: "calc(100% + 6px)", top: "50%", transform: "translateY(-50%)" };
  return (
    <span
      style={{ position: "relative", display: "inline-flex", ...style }}
      onMouseEnter={() => setOn(true)}
      onMouseLeave={() => setOn(false)}
      onFocus={() => setOn(true)}
      onBlur={() => setOn(false)}
    >
      {children}
      {on && (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            zIndex: 50,
            ...pos,
            padding: "4px 7px",
            background: "var(--surface-inverse)",
            color: "var(--text-inverse)",
            borderRadius: "var(--radius-sm)",
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-2xs)",
            lineHeight: 1.3,
            whiteSpace: "nowrap",
            boxShadow: "var(--shadow-md)",
            pointerEvents: "none",
          }}
        >
          {label}
        </span>
      )}
    </span>
  );
}
