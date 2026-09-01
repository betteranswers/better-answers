import * as React from "react";

/** The modular grid made visible. A port of `@magicui/grid-pattern` retuned to the
 *  blueprint tokens. One per screen, absolutely positioned behind the page content.
 *  The parent must be `position: relative`. */
export interface GridPatternProps extends React.SVGAttributes<SVGElement> {
  /** Module width in px. Default 32 (= --grid-module). */
  width?: number;
  /** Module height in px. Default 32. */
  height?: number;
  /** Pattern origin offset. Default -1 so the hairline lands on the edge. */
  x?: number;
  y?: number;
  /** Dash the grid lines, e.g. "2 3" for a plotted grid. Default "0" (solid). */
  strokeDasharray?: string;
  /** Fill individual modules: [[col,row], …]. Use sparingly, as emphasis. */
  squares?: Array<[number, number]>;
  /** Line colour. Default var(--grid-line). */
  stroke?: string;
  /** Radial mask so the grid dissolves away from the top. Default true. */
  fade?: boolean;
}
export declare function GridPattern(props: GridPatternProps): JSX.Element;
