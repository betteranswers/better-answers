import * as React from "react";

/** Names an icon-only control or spells out a keystroke. Never carries information a reader needs to decide. */
export interface TooltipProps {
  label: string;
  side?: "top" | "bottom" | "left" | "right";
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export function Tooltip(props: TooltipProps): JSX.Element;
