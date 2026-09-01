import * as React from "react";

/** A square, label-required icon control for toolbars, table rows and panel headers. */
export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name — required; also renders as the title ([A11Y1]). */
  label: string;
  size?: "sm" | "md" | "lg";
  variant?: "ghost" | "outline";
  active?: boolean;
  children?: React.ReactNode;
}
export function IconButton(props: IconButtonProps): JSX.Element;
