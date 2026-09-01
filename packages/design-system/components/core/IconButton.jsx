import React from "react";

const SIZES = { sm: "24px", md: "28px", lg: "32px" };

export function IconButton({
  label,
  size = "md",
  variant = "ghost",
  active = false,
  disabled = false,
  onClick,
  children,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const d = SIZES[size] || SIZES.md;
  const bg = active
    ? "var(--surface-active)"
    : hover && !disabled
      ? "var(--surface-hover)"
      : "transparent";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: d,
        height: d,
        borderRadius: "var(--radius-sm)",
        border: variant === "outline" ? "1px solid var(--border-default)" : "1px solid transparent",
        background: variant === "outline" && !hover ? "var(--control-secondary-bg)" : bg,
        color: disabled
          ? "var(--control-disabled-fg)"
          : active
            ? "var(--text-primary)"
            : "var(--text-secondary)",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "var(--transition-control)",
        padding: 0,
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
