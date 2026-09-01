import React from "react";

export function RadioGroup({ legend, name, value, options = [], onChange, style }) {
  return (
    <fieldset
      style={{
        border: "none",
        margin: 0,
        padding: 0,
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        fontFamily: "var(--font-sans)",
        ...style,
      }}
    >
      {legend && (
        <legend
          style={{
            padding: 0,
            fontSize: "var(--text-xs)",
            fontWeight: "var(--weight-medium)",
            color: "var(--text-body)",
            marginBottom: "2px",
          }}
        >
          {legend}
        </legend>
      )}
      {options.map((o) => {
        const v = typeof o === "string" ? o : o.value,
          l = typeof o === "string" ? o : o.label,
          d = typeof o === "string" ? null : o.description;
        return (
          <label
            key={v}
            style={{
              display: "flex",
              gap: "8px",
              alignItems: d ? "flex-start" : "center",
              cursor: "pointer",
            }}
          >
            <input
              type="radio"
              name={name}
              value={v}
              checked={value === v}
              onChange={() => onChange && onChange(v)}
              style={{
                width: "15px",
                height: "15px",
                margin: 0,
                marginTop: d ? "1px" : 0,
                accentColor: "var(--accent-600)",
                flexShrink: 0,
              }}
            />
            <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <span
                style={{ fontSize: "var(--text-base)", color: "var(--text-body)", lineHeight: 1.3 }}
              >
                {l}
              </span>
              {d && (
                <span
                  style={{
                    fontSize: "var(--text-xs)",
                    color: "var(--text-muted)",
                    lineHeight: 1.4,
                  }}
                >
                  {d}
                </span>
              )}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
