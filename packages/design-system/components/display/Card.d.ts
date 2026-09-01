import * as React from "react";

/**
 * A hairline panel: 1px border, square corners, no shadow at rest. The product's content
 * container. For a board-level object — a figure, a diagram, a page region — use `Frame`.
 * @startingPoint section="Display" subtitle="Cards, tags, trust words and summary lists" viewport="700x340"
 */
export interface CardProps extends React.HTMLAttributes<HTMLElement> {
  title?: React.ReactNode;
  /** Quiet line under the title — a count, a date, a source name. */
  meta?: React.ReactNode;
  /** Buttons pinned to the header's right. */
  actions?: React.ReactNode;
  /** Sunken strip under the body — provenance, counts, "map as of …". */
  footer?: React.ReactNode;
  padding?: "none" | "sm" | "md" | "lg";
  elevated?: boolean;
  interactive?: boolean;
  /**
   * Draw "+" registration marks on the corners. Off by default. Turn on only when the card is a
   * direct child of the page grid — never on a nested card, and never more than three marked
   * objects on a screen. Turning it on stops the card clipping its overflow.
   */
  marks?: boolean;
  children?: React.ReactNode;
}
export function Card(props: CardProps): JSX.Element;
