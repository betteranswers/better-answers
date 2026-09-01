import * as React from "react";

/** A small labelled chip: a kind, a domain, a tag from a concept, a filter in force. */
export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: "neutral" | "accent" | "success" | "warning" | "danger";
  size?: "sm" | "md";
  icon?: React.ReactNode;
  /** Renders a remove affordance — filter chips only. */
  onRemove?: () => void;
  children?: React.ReactNode;
}
export function Tag(props: TagProps): JSX.Element;
