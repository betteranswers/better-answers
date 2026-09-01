import * as React from "react";

/** An immediate-effect toggle (a setting that applies on flick) — never a form field awaiting Save. */
export interface SwitchProps {
  label?: string;
  description?: string;
  checked?: boolean;
  disabled?: boolean;
  onChange?: (next: boolean) => void;
  id?: string;
  style?: React.CSSProperties;
}
export function Switch(props: SwitchProps): JSX.Element;
