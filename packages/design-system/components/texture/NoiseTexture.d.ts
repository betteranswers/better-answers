import * as React from "react";

/** A port of `@magicui/noise-texture` retuned to the blueprint tokens. A fractal-noise
 *  film over dark and accent surfaces so large flat fills do not read as dead pixels.
 *  The parent must be `position: relative`. Suppressed under
 *  `prefers-reduced-transparency`. */
export interface NoiseTextureProps extends React.SVGAttributes<SVGElement> {
  /** Film opacity. Default var(--noise-opacity) — 3.5% light, 5% dark. Never above 0.05. */
  opacity?: number | string;
  /** feTurbulence base frequency. Default 0.82 — fine grain, no visible pattern. */
  baseFrequency?: number | string;
  /** feTurbulence octaves. Default 4. */
  numOctaves?: number;
  /** Blend mode against the surface below. Default "overlay". */
  blend?: React.CSSProperties["mixBlendMode"];
}
export declare function NoiseTexture(props: NoiseTextureProps): JSX.Element;
