import * as React from "react";

/**
 * A modal used only where an act cannot be undone by the same click that made it.
 * Its `consequence` line states what will happen before the button is pressed ([UX1]).
 */
export interface DialogProps {
  open?: boolean;
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Quiet line beside the actions: "One governed write. Audited under your name." */
  consequence?: React.ReactNode;
  actions?: React.ReactNode;
  onClose?: () => void;
  width?: number;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export function Dialog(props: DialogProps): JSX.Element | null;
