import React from "react";

export function SideNav({ sections = [], value, onChange, header, footer, width, style, ...rest }) {
  return (
    <nav
      style={{
        width: width || "var(--sidebar-w)",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--surface-sunken)",
        borderRight: "1px solid var(--border-subtle)",
        fontFamily: "var(--font-sans)",
        ...style,
      }}
      {...rest}
    >
      {header && (
        <div style={{ padding: "12px", borderBottom: "1px solid var(--border-subtle)" }}>
          {header}
        </div>
      )}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "10px 8px",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
        }}
      >
        {sections.map((s, si) => (
          <div key={si} style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
            {s.label && (
              <p
                style={{
                  margin: "0 0 5px 8px",
                  fontSize: "var(--text-2xs)",
                  fontWeight: "var(--weight-medium)",
                  letterSpacing: "var(--tracking-caps)",
                  textTransform: "uppercase",
                  color: "var(--text-faint)",
                }}
              >
                {s.label}
              </p>
            )}
            {(s.items || []).map((it) => {
              const on = it.value === value;
              return (
                <button
                  key={it.value}
                  onClick={() => onChange && onChange(it.value)}
                  aria-current={on ? "page" : undefined}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    width: "100%",
                    padding: "6px 8px",
                    border: "none",
                    borderRadius: "var(--radius-sm)",
                    cursor: "pointer",
                    textAlign: "left",
                    background: on ? "var(--surface-active)" : "transparent",
                    color: on ? "var(--text-primary)" : "var(--text-secondary)",
                    fontFamily: "inherit",
                    fontSize: "var(--text-base)",
                    fontWeight: on ? "var(--weight-medium)" : "var(--weight-regular)",
                    transition: "var(--transition-control)",
                  }}
                  onMouseEnter={(e) => {
                    if (!on) e.currentTarget.style.background = "var(--surface-hover)";
                  }}
                  onMouseLeave={(e) => {
                    if (!on) e.currentTarget.style.background = "transparent";
                  }}
                >
                  {it.icon && (
                    <span
                      style={{
                        display: "flex",
                        color: on ? "var(--text-primary)" : "var(--text-faint)",
                      }}
                    >
                      {it.icon}
                    </span>
                  )}
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {it.label}
                  </span>
                  {it.trailing}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {footer && (
        <div style={{ padding: "10px 12px", borderTop: "1px solid var(--border-subtle)" }}>
          {footer}
        </div>
      )}
    </nav>
  );
}
