import React from "react";

/* @magicui/noise-texture, retuned to the blueprint tokens.
   A fractal-noise film that stops large flat fills reading as dead pixels. Used on
   dark and accent surfaces only, at 3.5–5%: the dark page, the dialog scrim, a
   full-bleed accent band. Never over body prose, never on a white card, never above
   5% — it is grain, not a pattern. */

let n = 0;
export function NoiseTexture({
  opacity = "var(--noise-opacity)",
  baseFrequency = "var(--noise-frequency)",
  numOctaves = 4,
  blend = "overlay",
  style,
  ...rest
}) {
  const id = React.useMemo(() => "ba-noise-" + ++n, []);
  const freq =
    typeof baseFrequency === "string" && baseFrequency.startsWith("var(") ? 0.82 : baseFrequency;
  return (
    <svg
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        opacity,
        mixBlendMode: blend,
        ...style,
      }}
      {...rest}
    >
      <filter id={id} x="0" y="0" width="100%" height="100%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency={freq}
          numOctaves={numOctaves}
          stitchTiles="stitch"
        />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="100%" height="100%" filter={`url(#${id})`} />
    </svg>
  );
}
