import React from "react";

export function EmptyState({ title, description, action, icon, style, ...rest }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "6px",
        padding: "40px 24px",
        textAlign: "center",
        fontFamily: "var(--font-sans)",
        ...style,
      }}
      {...rest}
    >
      {icon && <span style={{ color: "var(--text-faint)", marginBottom: "4px" }}>{icon}</span>}
      <p
        style={{
          margin: 0,
          fontSize: "var(--text-md)",
          fontWeight: "var(--weight-medium)",
          color: "var(--text-primary)",
        }}
      >
        {title}
      </p>
      {description && (
        <p
          style={{
            margin: 0,
            maxWidth: "46ch",
            fontSize: "var(--text-sm)",
            color: "var(--text-muted)",
            lineHeight: "var(--leading-normal)",
          }}
        >
          {description}
        </p>
      )}
      {action && <div style={{ marginTop: "10px" }}>{action}</div>}
    </div>
  );
}
