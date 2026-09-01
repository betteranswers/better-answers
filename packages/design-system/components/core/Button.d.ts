import * as React from "react";

/**
 * The one button. Square corners, hairline edges. `primary` is the single solid object
 * on the board — an accent fill carrying the "+" registration marks, one per view.
 * Everything else is a line drawing.
 * @startingPoint section="Core" subtitle="Buttons, icon buttons and toolbars" viewport="700x180"
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * `primary` — accent fill + registration marks, the one solid object. **One per view.**
   * `accent` — the same accent fill *without* marks, for a repeated committing action in a
   *   list row or a toolbar, where registering every instance would multiply the marks.
   * `solid` — near-black fill, for a commit that must not read as the primary.
   * `secondary` — hairline. `ghost` — no edge, for dense toolbars. `danger` — hairline, red word.
   */
  variant?: "primary" | "accent" | "solid" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  /** Swaps the left icon for a spinner and disables the control. */
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  /** Override the registration marks. Defaults to on for `primary` only — off for every
   *  other variant, including `accent`. Set explicitly only to unmark a lone primary. */
  marks?: boolean;
  children?: React.ReactNode;
}
export function Button(props: ButtonProps): JSX.Element;
