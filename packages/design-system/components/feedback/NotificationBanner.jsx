import React from "react";

const TONES = {
  info: { bg: "var(--accent-50)", bd: "var(--accent-200)", fg: "var(--accent-700)" },
  success: { bg: "var(--green-50)", bd: "var(--green-200)", fg: "var(--green-700)" },
  warning: { bg: "var(--amber-50)", bd: "var(--amber-200)", fg: "var(--amber-700)" },
  danger: { bg: "var(--red-50)", bd: "var(--red-200)", fg: "var(--red-700)" },
};

export function NotificationBanner({ tone = "info", heading, children, action, style, ...rest }) {
  const t = TONES[tone] || TONES.info;
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "12px",
        padding: "11px 14px",
        background: t.bg,
        border: "1px solid " + t.bd,
        borderRadius: "var(--radius-md)",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-base)",
        lineHeight: "var(--leading-normal)",
        color: "var(--text-body)",
        ...style,
      }}
      {...rest}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {heading && (
          <strong
            style={{
              display: "block",
              color: t.fg,
              fontWeight: "var(--weight-semibold)",
              marginBottom: "2px",
            }}
          >
            {heading}
          </strong>
        )}
        {children}
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  );
}
