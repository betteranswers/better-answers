import * as React from "react";

/** GOV.UK summary-list semantics without the GOV.UK brand ([A11Y1]): term, value, and the action beside it. */
export interface SummaryItem {
  term: React.ReactNode;
  description: React.ReactNode;
  /** Right-aligned action for this row — usually a ghost Button. */
  action?: React.ReactNode;
}
export interface SummaryListProps extends React.HTMLAttributes<HTMLDListElement> {
  items?: SummaryItem[];
  dense?: boolean;
}
export function SummaryList(props: SummaryListProps): JSX.Element;
