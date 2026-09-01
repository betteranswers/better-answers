import * as React from "react";

/** Native select in the product's field shell — used for roles, sensitivity, cadence. */
export interface SelectOption {
  value: string;
  label: string;
}
export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  label?: string;
  hint?: string;
  options?: Array<SelectOption | string>;
  size?: "sm" | "md" | "lg";
}
export function Select(props: SelectProps): JSX.Element;
