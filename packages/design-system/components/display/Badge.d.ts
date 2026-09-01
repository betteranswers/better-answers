import * as React from "react";

/** A count pill for a queue length in navigation — numbers only, never a status word. */
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  count?: number | string;
  /** Renders "99+" above this. */
  max?: number;
  tone?: "neutral" | "accent" | "danger";
}
export function Badge(props: BadgeProps): JSX.Element;
