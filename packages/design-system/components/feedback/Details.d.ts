import * as React from "react";

/** The one disclosure ([UX1]): the second level under a claim — verifier, date, evidence passage, history. */
export interface DetailsProps extends React.HTMLAttributes<HTMLDivElement> {
  summary: React.ReactNode;
  defaultOpen?: boolean;
  children?: React.ReactNode;
}
export function Details(props: DetailsProps): JSX.Element;
