import React from "react";

export function Badge({ count, max = 99, tone = "neutral", style, ...rest }) {
  const n = typeof count === "number" && count > max ? `${max}+` : count;
  const tones = {
    neutral: { bg: "var(--surface-inset)", fg: "var(--text-secondary)" },
    accent: { bg: "var(--accent-600)", fg: "#fff" },
    danger: { bg: "var(--red-600)", fg: "#fff" },
  };
  const t = tones[tone] || tones.neutral;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: "18px",
        height: "18px",
        padding: "0 5px",
        borderRadius: 0,
        background: t.bg,
        color: t.fg,
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-2xs)",
        fontWeight: "var(--weight-medium)",
        fontVariantNumeric: "tabular-nums",
        ...style,
      }}
      {...rest}
    >
      {n}
    </span>
  );
}
