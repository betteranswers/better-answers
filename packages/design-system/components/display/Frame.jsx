import React from "react";

/* The blueprint object. A transparent line drawing on the modular grid: square
   corners, one hairline, and four "+" registration marks centred on the corners.

   Marks are rationed. Frame is the *board-level* object — a figure, a diagram, a
   region of the page. Anything drawn inside a Frame is unmarked. See
   guidelines/blueprint-marks.card.html. */

const ARM = "var(--mark-arm)";

export function RegMark({ color = "var(--mark-color)", arm = ARM, style, ...rest }) {
  const line = `linear-gradient(${color},${color})`;
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        width: arm,
        height: arm,
        pointerEvents: "none",
        backgroundImage: `${line},${line}`,
        backgroundRepeat: "no-repeat,no-repeat",
        backgroundPosition: "center center,center center",
        backgroundSize: `100% var(--mark-weight),var(--mark-weight) 100%`,
        ...style,
      }}
      {...rest}
    />
  );
}

export function RegMarks({ color = "var(--mark-color)", arm = ARM, corners = "all" }) {
  const off = `calc(${arm} / -2)`;
  const all = corners === "all";
  const want = all ? ["tl", "tr", "bl", "br"] : String(corners).split(/[\s,]+/);
  const pos = {
    tl: { top: off, left: off },
    tr: { top: off, right: off },
    bl: { bottom: off, left: off },
    br: { bottom: off, right: off },
  };
  return (
    <>{want.map((k) => pos[k] && <RegMark key={k} color={color} arm={arm} style={pos[k]} />)}</>
  );
}

export function Frame({
  as = "div",
  label,
  note,
  marks = true,
  corners = "all",
  surface = "transparent",
  border = "var(--border-default)",
  padding = "16px",
  markColor,
  children,
  style,
  ...rest
}) {
  const Tag = as;
  return (
    <Tag
      style={{
        position: "relative",
        background: surface,
        border: `1px solid ${border}`,
        borderRadius: 0,
        padding,
        fontFamily: "var(--font-sans)",
        color: "var(--text-body)",
        ...style,
      }}
      {...rest}
    >
      {marks && <RegMarks color={markColor || "var(--mark-color)"} corners={corners} />}
      {(label || note) && (
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: "12px",
            marginBottom: "10px",
          }}
        >
          {label && (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-2xs)",
                letterSpacing: "var(--tracking-caps)",
                textTransform: "uppercase",
                color: "var(--text-muted)",
              }}
            >
              {label}
            </span>
          )}
          {note && (
            <span style={{ fontSize: "var(--text-2xs)", color: "var(--text-faint)" }}>{note}</span>
          )}
        </div>
      )}
      {children}
    </Tag>
  );
}
