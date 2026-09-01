import React from "react";

const PADS = { none: "0", sm: "12px", md: "16px", lg: "20px" };

function Marks({ color = "var(--mark-color)" }) {
  const line = `linear-gradient(${color},${color})`;
  const base = {
    position: "absolute",
    width: "var(--mark-arm)",
    height: "var(--mark-arm)",
    pointerEvents: "none",
    backgroundImage: `${line},${line}`,
    backgroundRepeat: "no-repeat,no-repeat",
    backgroundPosition: "center center,center center",
    backgroundSize: "100% var(--mark-weight),var(--mark-weight) 100%",
  };
  const o = "calc(var(--mark-arm) / -2)";
  return (
    <>
      <span aria-hidden="true" style={{ ...base, top: o, left: o }} />
      <span aria-hidden="true" style={{ ...base, top: o, right: o }} />
      <span aria-hidden="true" style={{ ...base, bottom: o, left: o }} />
      <span aria-hidden="true" style={{ ...base, bottom: o, right: o }} />
    </>
  );
}

/* Square corners, one hairline, no shadow at rest. `marks` is opt-in: turn it on only
   when the card is a direct child of the page grid — never on a nested card, and never
   more than three marked objects on a screen. */
export function Card({
  title,
  meta,
  actions,
  footer,
  padding = "md",
  elevated = false,
  interactive = false,
  marks = false,
  children,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  return (
    <section
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        background: "var(--surface-card)",
        border:
          "1px solid " + (interactive && hover ? "var(--border-strong)" : "var(--border-subtle)"),
        borderRadius: 0,
        boxShadow: elevated ? "var(--shadow-md)" : "none",
        fontFamily: "var(--font-sans)",
        overflow: marks ? "visible" : "hidden",
        transition: "var(--transition-control)",
        cursor: interactive ? "pointer" : "default",
        ...style,
      }}
      {...rest}
    >
      {marks && <Marks color={interactive && hover ? "var(--accent-400)" : "var(--mark-color)"} />}
      {(title || actions) && (
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: PADS[padding] === "0" ? "14px 16px" : `${PADS[padding]} ${PADS[padding]} 0`,
          }}
        >
          <div
            style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flex: 1 }}
          >
            {title && (
              <h3
                style={{
                  margin: 0,
                  fontSize: "var(--text-md)",
                  fontWeight: "var(--weight-semibold)",
                  letterSpacing: "var(--tracking-heading)",
                  color: "var(--text-primary)",
                }}
              >
                {title}
              </h3>
            )}
            {meta && (
              <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                {meta}
              </p>
            )}
          </div>
          {actions && <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>{actions}</div>}
        </header>
      )}
      <div
        style={{ padding: PADS[padding], paddingTop: title || actions ? "12px" : PADS[padding] }}
      >
        {children}
      </div>
      {footer && (
        <footer
          style={{
            padding: `10px ${PADS[padding] === "0" ? "16px" : PADS[padding]}`,
            borderTop: "1px solid var(--border-subtle)",
            background: "var(--surface-sunken)",
            fontSize: "var(--text-xs)",
            color: "var(--text-muted)",
          }}
        >
          {footer}
        </footer>
      )}
    </section>
  );
}
