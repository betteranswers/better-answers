import React from "react";

export function Checkbox({
  label,
  description,
  checked,
  indeterminate = false,
  disabled = false,
  onChange,
  id,
  style,
}) {
  const fid = id || React.useId();
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <label
      htmlFor={fid}
      style={{
        display: "flex",
        gap: "8px",
        alignItems: description ? "flex-start" : "center",
        fontFamily: "var(--font-sans)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        ...style,
      }}
    >
      <input
        ref={ref}
        id={fid}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        style={{
          width: "15px",
          height: "15px",
          margin: 0,
          marginTop: description ? "1px" : 0,
          accentColor: "var(--accent-600)",
          flexShrink: 0,
          cursor: "inherit",
        }}
      />
      {(label || description) && (
        <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
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
        </span>
      )}
    </label>
  );
}
