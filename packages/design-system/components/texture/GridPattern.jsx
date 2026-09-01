import React from "react";

/* @magicui/grid-pattern, retuned to the blueprint tokens.
   The modular grid, made visible. One per screen, behind everything, on the page
   substrate — never inside a card, never behind body prose at full strength. */

let n = 0;
export function GridPattern({
  width = 32,
  height = 32,
  x = -1,
  y = -1,
  strokeDasharray = "0",
  squares,
  stroke = "var(--grid-line)",
  fade = true,
  style,
  ...rest
}) {
  const id = React.useMemo(() => "ba-grid-" + ++n, []);
  return (
    <svg
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        color: stroke,
        maskImage: fade
          ? "radial-gradient(120% 90% at 50% 0%,#000 35%,transparent 100%)"
          : undefined,
        WebkitMaskImage: fade
          ? "radial-gradient(120% 90% at 50% 0%,#000 35%,transparent 100%)"
          : undefined,
        ...style,
      }}
      {...rest}
    >
      <defs>
        <pattern id={id} width={width} height={height} patternUnits="userSpaceOnUse" x={x} y={y}>
          <path
            d={`M.5 ${height}V.5H${width}`}
            fill="none"
            stroke="currentColor"
            strokeDasharray={strokeDasharray}
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
      {Array.isArray(squares) && (
        <svg x={x} y={y}>
          {squares.map(([sx, sy], i) => (
            <rect
              key={i}
              width={width - 1}
              height={height - 1}
              x={sx * width + 1}
              y={sy * height + 1}
              fill="var(--grid-line-strong)"
              strokeWidth="0"
            />
          ))}
        </svg>
      )}
    </svg>
  );
}
