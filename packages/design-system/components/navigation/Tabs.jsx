import React from "react";

export function Tabs({ tabs = [], value, onChange, size = "md", style, ...rest }) {
  const sm = size === "sm";
  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        gap: "2px",
        alignItems: "flex-end",
        borderBottom: "1px solid var(--border-subtle)",
        fontFamily: "var(--font-sans)",
        ...style,
      }}
      {...rest}
    >
      {tabs.map((t) => {
        const v = typeof t === "string" ? t : t.value,
          l = typeof t === "string" ? t : t.label,
          c = typeof t === "string" ? null : t.count;
        const on = v === value;
        return (
          <button
            key={v}
            role="tab"
            aria-selected={on}
            onClick={() => onChange && onChange(v)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: sm ? "6px 8px" : "8px 10px",
              border: "none",
              background: "none",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: sm ? "var(--text-xs)" : "var(--text-base)",
              fontWeight: "var(--weight-medium)",
              letterSpacing: "var(--tracking-body)",
              color: on ? "var(--text-primary)" : "var(--text-muted)",
              boxShadow: on ? "inset 0 -1.5px 0 var(--text-primary)" : "none",
              transition: "var(--transition-control)",
            }}
          >
            {l}
            {c != null && (
              <span
                style={{
                  fontSize: "var(--text-2xs)",
                  color: "var(--text-faint)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {c}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
