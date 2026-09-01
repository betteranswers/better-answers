import React from "react";

/* The reader-facing trust words are fixed by CONTEXT.md and ADR 0019.
   Each is a word first; the tint is a second, redundant signal ([UX1]). */
const WORDS = {
  checked: {
    label: "Checked",
    bg: "var(--trust-checked-bg)",
    fg: "var(--trust-checked-fg)",
    bd: "var(--trust-checked-border)",
  },
  "checked-by-platform": {
    label: "Checked by the platform",
    bg: "var(--trust-checked-bg)",
    fg: "var(--trust-checked-fg)",
    bd: "var(--trust-checked-border)",
  },
  unchecked: {
    label: "Unchecked",
    bg: "var(--trust-unchecked-bg)",
    fg: "var(--trust-unchecked-fg)",
    bd: "var(--trust-unchecked-border)",
  },
  "changed-since-checked": {
    label: "Changed since checked",
    bg: "var(--trust-stale-bg)",
    fg: "var(--trust-stale-fg)",
    bd: "var(--trust-stale-border)",
  },
  "out-of-date": {
    label: "Out of date",
    bg: "var(--trust-stale-bg)",
    fg: "var(--trust-stale-fg)",
    bd: "var(--trust-stale-border)",
  },
  draft: {
    label: "Draft",
    bg: "var(--trust-draft-bg)",
    fg: "var(--trust-draft-fg)",
    bd: "var(--trust-draft-border)",
  },
  restricted: {
    label: "Restricted",
    bg: "var(--trust-restricted-bg)",
    fg: "var(--trust-restricted-fg)",
    bd: "var(--trust-restricted-border)",
  },
  left: {
    label: "Left",
    bg: "var(--trust-unchecked-bg)",
    fg: "var(--trust-unchecked-fg)",
    bd: "var(--trust-unchecked-border)",
  },
  deprecated: {
    label: "Deprecated",
    bg: "var(--trust-unchecked-bg)",
    fg: "var(--trust-unchecked-fg)",
    bd: "var(--trust-unchecked-border)",
  },
};

export function TrustTag({ state = "unchecked", by, at, rider, size = "md", style, ...rest }) {
  const w = WORDS[state] || WORDS.unchecked;
  const sm = size === "sm";
  let label = w.label;
  if (state === "checked") label = by ? `Checked by ${by}` : "Checked";
  const detail = [at, rider].filter(Boolean).join(" · ");
  return (
    <span
      title={detail || undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        height: sm ? "18px" : "22px",
        padding: sm ? "0 6px" : "0 8px",
        borderRadius: "var(--radius-sm)",
        background: w.bg,
        color: w.fg,
        border: "1px solid " + w.bd,
        fontFamily: "var(--font-sans)",
        fontSize: sm ? "var(--text-2xs)" : "var(--text-xs)",
        fontWeight: "var(--weight-medium)",
        whiteSpace: "nowrap",
        ...style,
      }}
      {...rest}
    >
      {label}
      {detail && (
        <span style={{ opacity: 0.75, fontWeight: "var(--weight-regular)" }}>· {detail}</span>
      )}
    </span>
  );
}
