import React from "react";

export function Switch({
  label,
  description,
  checked = false,
  disabled = false,
  onChange,
  id,
  style,
}) {
  const fid = id || React.useId();
  return (
    <div
      style={{
        display: "flex",
        gap: "10px",
        alignItems: description ? "flex-start" : "center",
        fontFamily: "var(--font-sans)",
        opacity: disabled ? 0.55 : 1,
        ...style,
      }}
    >
      <button
        id={fid}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange && onChange(!checked)}
        style={{
          position: "relative",
          width: "30px",
          height: "18px",
          flexShrink: 0,
          padding: 0,
          borderRadius: 0,
          border: "1px solid " + (checked ? "transparent" : "var(--border-strong)"),
          background: checked ? "var(--control-accent-bg)" : "var(--surface-inset)",
          cursor: disabled ? "not-allowed" : "pointer",
          transition: "var(--transition-control)",
          marginTop: description ? "1px" : 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: "1px",
            left: checked ? "13px" : "1px",
            width: "14px",
            height: "14px",
            borderRadius: 0,
            background: "#fff",
            boxShadow: "var(--shadow-sm)",
            transition: "left var(--duration-fast) var(--ease-standard)",
          }}
        />
      </button>
      {(label || description) && (
        <label
          htmlFor={fid}
          style={{ display: "flex", flexDirection: "column", gap: "2px", cursor: "pointer" }}
        >
          {label && (
            <span
              style={{ fontSize: "var(--text-base)", color: "var(--text-body)", lineHeight: 1.3 }}
            >
              {label}
            </span>
          )}
          {description && (
            <span
              style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", lineHeight: 1.4 }}
            >
              {description}
            </span>
          )}
        </label>
      )}
    </div>
  );
}
