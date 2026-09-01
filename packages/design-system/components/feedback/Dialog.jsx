import React from "react";

export function Dialog({
  open = false,
  title,
  description,
  consequence,
  actions,
  onClose,
  width = 480,
  children,
  style,
}) {
  React.useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (e.key === "Escape" && onClose) onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        background: "var(--surface-scrim)",
        backdropFilter: "var(--blur-scrim)",
        animation: "ba-fade var(--duration-base) var(--ease-standard)",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: width,
          maxWidth: "100%",
          background: "var(--surface-card)",
          borderRadius: "var(--radius-xl)",
          border: "1px solid var(--border-subtle)",
          boxShadow: "var(--shadow-dialog)",
          fontFamily: "var(--font-sans)",
          animation: "ba-rise var(--duration-base) var(--ease-out)",
          ...style,
        }}
      >
        <div style={{ padding: "20px 20px 0" }}>
          {title && (
            <h2
              style={{
                margin: 0,
                fontSize: "var(--text-xl)",
                fontWeight: "var(--weight-semibold)",
                letterSpacing: "var(--tracking-heading)",
                color: "var(--text-primary)",
              }}
            >
              {title}
            </h2>
          )}
          {description && (
            <p
              style={{
                margin: "6px 0 0",
                fontSize: "var(--text-base)",
                lineHeight: "var(--leading-normal)",
                color: "var(--text-secondary)",
              }}
            >
              {description}
            </p>
          )}
        </div>
        {children && <div style={{ padding: "16px 20px 0" }}>{children}</div>}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "18px 20px 18px",
            marginTop: "4px",
          }}
        >
          {consequence && (
            <p
              style={{
                margin: 0,
                flex: 1,
                fontSize: "var(--text-xs)",
                color: "var(--text-muted)",
                lineHeight: 1.4,
              }}
            >
              {consequence}
            </p>
          )}
          <div style={{ display: "flex", gap: "8px", marginLeft: consequence ? 0 : "auto" }}>
            {actions}
          </div>
        </div>
      </div>
    </div>
  );
}
