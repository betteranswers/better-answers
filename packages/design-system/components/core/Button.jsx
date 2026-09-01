import React from "react";

/* Square corners, hairline edges. The primary button is the one solid object on the
   board: an accent fill that keeps the square corners and carries the "+" marks.
   Everything else is a line drawing. One primary per view. */

const SIZES = {
  sm: { height: "26px", padding: "0 10px", fontSize: "var(--text-xs)", gap: "6px" },
  md: { height: "32px", padding: "0 14px", fontSize: "var(--text-base)", gap: "7px" },
  lg: { height: "40px", padding: "0 18px", fontSize: "var(--text-md)", gap: "8px" },
};

const VARIANTS = {
  primary: {
    background: "var(--control-accent-bg)",
    color: "var(--text-on-accent)",
    borderColor: "var(--control-accent-bg)",
  },
  accent: {
    background: "var(--control-accent-bg)",
    color: "var(--text-on-accent)",
    borderColor: "var(--control-accent-bg)",
  },
  solid: {
    background: "var(--control-primary-bg)",
    color: "var(--control-primary-fg)",
    borderColor: "var(--control-primary-bg)",
  },
  secondary: {
    background: "var(--control-secondary-bg)",
    color: "var(--text-body)",
    borderColor: "var(--border-default)",
  },
  ghost: { background: "transparent", color: "var(--text-body)", borderColor: "transparent" },
  danger: {
    background: "var(--surface-card)",
    color: "var(--control-danger-fg)",
    borderColor: "var(--border-default)",
  },
};

const HOVER = {
  primary: "var(--control-accent-bg-hover)",
  accent: "var(--control-accent-bg-hover)",
  solid: "var(--control-primary-bg-hover)",
  secondary: "var(--control-secondary-bg-hover)",
  ghost: "var(--surface-hover)",
  danger: "var(--red-50)",
};

function Marks({ color }) {
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

export function Button({
  variant = "secondary",
  size = "md",
  iconLeft,
  iconRight,
  loading = false,
  disabled = false,
  fullWidth = false,
  marks,
  type = "button",
  onClick,
  children,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const [press, setPress] = React.useState(false);
  const s = SIZES[size] || SIZES.md,
    v = VARIANTS[variant] || VARIANTS.secondary;
  const off = disabled || loading;
  /* Marks default on for `primary` only. `accent` is the same fill WITHOUT marks — the
     repeated committing action in a list or a toolbar, where a board-level registration
     would multiply. One marked primary per view; if you need two accent fills, the second
     is `accent`. */
  const showMarks = (marks === undefined ? variant === "primary" : marks) && !off;
  return (
    <button
      type={type}
      disabled={off}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setPress(false);
      }}
      onMouseDown={() => setPress(true)}
      onMouseUp={() => setPress(false)}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: s.gap,
        height: s.height,
        padding: s.padding,
        borderRadius: 0,
        width: fullWidth ? "100%" : undefined,
        borderWidth: "1px",
        borderStyle: "solid",
        boxShadow: "none",
        fontFamily: "var(--font-sans)",
        fontSize: s.fontSize,
        fontWeight: "var(--weight-medium)",
        letterSpacing: "var(--tracking-body)",
        lineHeight: 1,
        whiteSpace: "nowrap",
        cursor: off ? "not-allowed" : "pointer",
        transition:
          "var(--transition-control), transform var(--duration-instant) var(--ease-standard)",
        transform: press && !off ? "translateY(0.5px)" : "none",
        opacity: off ? 0.55 : 1,
        ...v,
        background: off
          ? "var(--control-disabled-bg)"
          : hover && !off
            ? HOVER[variant]
            : v.background,
        ...(off && {
          borderColor: "var(--control-disabled-bg)",
          color: "var(--control-disabled-fg)",
        }),
        ...style,
      }}
      {...rest}
    >
      {showMarks && <Marks color={variant === "solid" ? "var(--grey-400)" : "var(--accent-300)"} />}
      {loading ? <Spinner /> : iconLeft}
      {children}
      {iconRight}
    </button>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      style={{
        width: "12px",
        height: "12px",
        borderRadius: "var(--radius-full)",
        border: "1.5px solid currentColor",
        borderTopColor: "transparent",
        display: "inline-block",
        animation: "ba-spin 620ms linear infinite",
      }}
    />
  );
}
