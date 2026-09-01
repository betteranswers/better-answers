import * as React from "react";

/** What a surface shows when the map has nothing: states the fact, then the one act that changes it. */
export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}
export function EmptyState(props: EmptyStateProps): JSX.Element;
