import React from "react";

export function DataTable({
  columns = [],
  rows = [],
  selectable = false,
  selected = [],
  onSelect,
  onRowClick,
  emptyLabel = "Nothing here yet.",
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(-1);
  const allOn = selectable && rows.length > 0 && selected.length === rows.length;
  return (
    <div
      style={{
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-lg)",
        background: "var(--surface-card)",
        overflowX: "auto",
        fontFamily: "var(--font-sans)",
        ...style,
      }}
      {...rest}
    >
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-base)" }}>
        <thead>
          <tr style={{ background: "var(--surface-sunken)" }}>
            {selectable && (
              <th style={{ width: "34px", padding: "0 0 0 12px" }}>
                <input
                  type="checkbox"
                  checked={allOn}
                  onChange={() => onSelect && onSelect(allOn ? [] : rows.map((_, i) => i))}
                  style={{
                    width: "14px",
                    height: "14px",
                    accentColor: "var(--accent-600)",
                    margin: 0,
                  }}
                />
              </th>
            )}
            {columns.map((c) => (
              <th
                key={c.key}
                style={{
                  textAlign: c.align || "left",
                  padding: "8px 12px",
                  fontSize: "var(--text-2xs)",
                  fontWeight: "var(--weight-medium)",
                  letterSpacing: "var(--tracking-caps)",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                  borderBottom: "1px solid var(--border-subtle)",
                  whiteSpace: "nowrap",
                  width: c.width,
                }}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={columns.length + (selectable ? 1 : 0)}
                style={{
                  padding: "28px 12px",
                  textAlign: "center",
                  color: "var(--text-muted)",
                  fontSize: "var(--text-sm)",
                }}
              >
                {emptyLabel}
              </td>
            </tr>
          )}
          {rows.map((r, i) => (
            <tr
              key={i}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(-1)}
              onClick={() => onRowClick && onRowClick(r, i)}
              style={{
                background: hover === i ? "var(--surface-hover)" : "transparent",
                cursor: onRowClick ? "pointer" : "default",
                transition: "background-color var(--duration-instant) var(--ease-standard)",
              }}
            >
              {selectable && (
                <td style={{ padding: "0 0 0 12px", borderTop: "1px solid var(--border-subtle)" }}>
                  <input
                    type="checkbox"
                    checked={selected.includes(i)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() =>
                      onSelect &&
                      onSelect(
                        selected.includes(i) ? selected.filter((x) => x !== i) : [...selected, i],
                      )
                    }
                    style={{
                      width: "14px",
                      height: "14px",
                      accentColor: "var(--accent-600)",
                      margin: 0,
                    }}
                  />
                </td>
              )}
              {columns.map((c) => (
                <td
                  key={c.key}
                  style={{
                    textAlign: c.align || "left",
                    padding: "9px 12px",
                    borderTop: "1px solid var(--border-subtle)",
                    color: "var(--text-body)",
                    fontVariantNumeric: c.align === "right" ? "tabular-nums" : "normal",
                  }}
                >
                  {c.render ? c.render(r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
