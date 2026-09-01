import * as React from "react";

/** Confirmation of an act that already happened, with its undo. Announced politely to assistive technology. */
export interface ToastProps extends React.HTMLAttributes<HTMLDivElement> {
  message: React.ReactNode;
  detail?: React.ReactNode;
  undoLabel?: string;
  onUndo?: () => void;
  onDismiss?: () => void;
  tone?: "neutral" | "success" | "warning" | "danger";
}
export function Toast(props: ToastProps): JSX.Element;
