import React from "react";

export function CoverageBar({ included = 0, expected = 0, label = "Coverage", style, ...rest }) {
  const pct = expected > 0 ? Math.min(100, Math.round((included / expected) * 100)) : 0;
  const short = Math.max(0, expected - included);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "5px",
        fontFamily: "var(--font-sans)",
        ...style,
      }}
      {...rest}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "8px",
        }}
      >
        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{label}</span>
        <span
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--text-body)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {included} of {expected}
          {short ? ` · ${short} missing` : ""}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{
          height: "4px",
          borderRadius: 0,
          background: "var(--surface-inset)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: pct + "%",
            height: "100%",
            background: short ? "var(--amber-600)" : "var(--green-600)",
            transition: "width var(--duration-slow) var(--ease-out)",
          }}
        />
      </div>
    </div>
  );
}
