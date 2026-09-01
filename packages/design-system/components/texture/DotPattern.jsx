import React from "react";

/* @magicui/dot-pattern, retuned to the blueprint tokens.
   For bounded, empty areas only: empty states, drop zones, the unbuilt region of a
   figure. It says "nothing is here yet" — so it never sits behind content. */

let n = 0;
export function DotPattern({
  width = 16,
  height = 16,
  cx = 1,
  cy = 1,
  cr = 1,
  x = 0,
  y = 0,
  color = "var(--dot-color)",
  fade = false,
  style,
  ...rest
}) {
  const id = React.useMemo(() => "ba-dots-" + ++n, []);
  const mask = "radial-gradient(70% 70% at 50% 50%,#000 40%,transparent 100%)";
  return (
    <svg
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        fill: color,
        maskImage: fade ? mask : undefined,
        WebkitMaskImage: fade ? mask : undefined,
        ...style,
      }}
      {...rest}
    >
      <defs>
        <pattern
          id={id}
          width={width}
          height={height}
          patternUnits="userSpaceOnUse"
          patternContentUnits="userSpaceOnUse"
          x={x}
          y={y}
        >
          <circle cx={cx} cy={cy} r={cr} fill="currentColor" style={{ fill: "inherit" }} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}
