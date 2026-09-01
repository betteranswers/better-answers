import React from "react";

const TONES = {
  neutral: { bg: "var(--surface-inset)", fg: "var(--text-secondary)", bd: "var(--border-default)" },
  accent: { bg: "var(--accent-50)", fg: "var(--accent-700)", bd: "var(--accent-200)" },
  success: { bg: "var(--green-50)", fg: "var(--green-700)", bd: "var(--green-200)" },
  warning: { bg: "var(--amber-50)", fg: "var(--amber-700)", bd: "var(--amber-200)" },
  danger: { bg: "var(--red-50)", fg: "var(--red-700)", bd: "var(--red-200)" },
};

export function Tag({ tone = "neutral", size = "md", icon, onRemove, children, style, ...rest }) {
  const t = TONES[tone] || TONES.neutral;
  const sm = size === "sm";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        height: sm ? "18px" : "22px",
        padding: sm ? "0 6px" : "0 8px",
        borderRadius: "var(--radius-sm)",
        background: t.bg,
        color: t.fg,
        border: "1px solid " + t.bd,
        fontFamily: "var(--font-sans)",
        fontSize: sm ? "var(--text-2xs)" : "var(--text-xs)",
        fontWeight: "var(--weight-medium)",
        letterSpacing: "var(--tracking-body)",
        whiteSpace: "nowrap",
        ...style,
      }}
      {...rest}
    >
      {icon}
      {children}
      {onRemove && (
        <button
          type="button"
          aria-label="Remove"
          onClick={onRemove}
          style={{
            border: "none",
            background: "none",
            padding: 0,
            marginLeft: "1px",
            cursor: "pointer",
            color: "inherit",
            opacity: 0.6,
            fontSize: "11px",
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      )}
    </span>
  );
}
