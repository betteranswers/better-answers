import * as React from "react";

/** A port of `@magicui/dot-pattern` retuned to the blueprint tokens. Marks a bounded
 *  area as empty — empty states, drop zones, the unbuilt part of a figure. Never
 *  behind content. The parent must be `position: relative`. */
export interface DotPatternProps extends React.SVGAttributes<SVGElement> {
  /** Cell width in px. Default 16 (= --dot-gap). */
  width?: number;
  /** Cell height in px. Default 16. */
  height?: number;
  /** Dot centre within the cell. Default 1 / 1. */
  cx?: number;
  cy?: number;
  /** Dot radius in px. Default 1 (= --dot-radius). */
  cr?: number;
  /** Pattern origin offset. Default 0. */
  x?: number;
  y?: number;
  /** Dot colour. Default var(--dot-color). */
  color?: string;
  /** Radial mask so the field dissolves at the edges. Default false. */
  fade?: boolean;
}
export declare function DotPattern(props: DotPatternProps): JSX.Element;
