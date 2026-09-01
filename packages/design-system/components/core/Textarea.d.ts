import * as React from "react";

/** Multi-line field for questions, suggestion reasons and concept bodies. */
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  rows?: number;
}
export function Textarea(props: TextareaProps): JSX.Element;
