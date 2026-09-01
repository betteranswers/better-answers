import React from "react";

export function Toast({
  message,
  detail,
  undoLabel,
  onUndo,
  onDismiss,
  tone = "neutral",
  style,
  ...rest
}) {
  const bar = {
    neutral: "var(--grey-400)",
    success: "var(--green-600)",
    warning: "var(--amber-600)",
    danger: "var(--red-600)",
  }[tone];
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        minWidth: "280px",
        maxWidth: "420px",
        padding: "10px 12px",
        background: "var(--surface-inverse)",
        color: "var(--text-inverse)",
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-lg)",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-base)",
        animation: "ba-rise var(--duration-base) var(--ease-out)",
        ...style,
      }}
      {...rest}
    >
      <span
        aria-hidden="true"
        style={{
          width: "3px",
          alignSelf: "stretch",
          borderRadius: 0,
          background: bar,
          flexShrink: 0,
        }}
      />
      <span style={{ flex: 1, minWidth: 0 }}>
        {message}
        {detail && (
          <span
            style={{
              display: "block",
              fontSize: "var(--text-xs)",
              opacity: 0.66,
              marginTop: "2px",
            }}
          >
            {detail}
          </span>
        )}
      </span>
      {undoLabel && (
        <button
          type="button"
          onClick={onUndo}
          style={{
            border: "none",
            background: "none",
            padding: "0 2px",
            color: "inherit",
            fontFamily: "inherit",
            fontSize: "var(--text-xs)",
            fontWeight: "var(--weight-medium)",
            textDecoration: "underline",
            textUnderlineOffset: "2px",
            cursor: "pointer",
          }}
        >
          {undoLabel}
        </button>
      )}
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          style={{
            border: "none",
            background: "none",
            padding: 0,
            color: "inherit",
            opacity: 0.5,
            cursor: "pointer",
            fontSize: "12px",
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}
