import * as React from "react";

/** Native checkbox with optional description line; supports the indeterminate state for select-all rows. */
export interface CheckboxProps {
  label?: string;
  description?: string;
  checked?: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  id?: string;
  style?: React.CSSProperties;
}
export function Checkbox(props: CheckboxProps): JSX.Element;
