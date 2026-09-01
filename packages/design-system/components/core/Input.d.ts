import * as React from "react";

/**
 * Single-line text field with optional label, hint and error line.
 * @startingPoint section="Core" subtitle="Text fields, selects and toggles" viewport="700x320"
 */
export interface InputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "size" | "prefix"
> {
  label?: string;
  /** Quiet helper line under the field. */
  hint?: string;
  /** Replaces the hint and reddens the border; write it as a sentence. */
  error?: string;
  size?: "sm" | "md" | "lg";
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
}
export function Input(props: InputProps): JSX.Element;
