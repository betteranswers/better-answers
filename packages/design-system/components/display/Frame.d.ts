import * as React from "react";

/** A board-level blueprint object: transparent, hairline-bordered, square-cornered,
 *  with "+" registration marks on its corners. Use for figures, diagrams and page
 *  regions — not for nested content, and never inside another marked Frame. */
export interface FrameProps extends React.HTMLAttributes<HTMLElement> {
  /** Element to render. Default "div". */
  as?: keyof JSX.IntrinsicElements;
  /** Optional uppercase mono caption in the top-left of the frame. */
  label?: React.ReactNode;
  /** Optional right-aligned note beside the label. */
  note?: React.ReactNode;
  /** Draw the registration marks. Default true. Set false when nested. */
  marks?: boolean;
  /** Which corners carry a mark: "all", or a subset like "tl br". Default "all". */
  corners?: "all" | string;
  /** Fill. Default "transparent" — a frame is a line drawing. */
  surface?: string;
  /** Border colour. Default var(--border-default). */
  border?: string;
  /** Inner padding. Default "16px". */
  padding?: string;
  /** Override the mark colour, e.g. var(--accent-600) on an active frame. */
  markColor?: string;
  children?: React.ReactNode;
}
export declare function Frame(props: FrameProps): JSX.Element;

/** The four corner marks on their own, for a container you position yourself.
 *  The parent must be `position: relative` and must not clip overflow. */
export interface RegMarksProps {
  color?: string;
  arm?: string;
  corners?: "all" | string;
}
export declare function RegMarks(props: RegMarksProps): JSX.Element;

/** A single "+" mark. Absolutely positioned; you supply top/left/right/bottom. */
export interface RegMarkProps extends React.HTMLAttributes<HTMLSpanElement> {
  color?: string;
  arm?: string;
}
export declare function RegMark(props: RegMarkProps): JSX.Element;
