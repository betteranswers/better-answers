import * as React from "react";

/** A fieldset of mutually exclusive choices — one decision, two to five options, each with an optional consequence line. */
export interface RadioOption {
  value: string;
  label: string;
  description?: string;
}
export interface RadioGroupProps {
  legend?: string;
  name: string;
  value?: string;
  options?: Array<RadioOption | string>;
  onChange?: (value: string) => void;
  style?: React.CSSProperties;
}
export function RadioGroup(props: RadioGroupProps): JSX.Element;
