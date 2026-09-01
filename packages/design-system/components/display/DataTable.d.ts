import * as React from "react";

/**
 * The review table: Knowledge, Questions, Sources and People are all this component.
 * Select-then-command ([UX2]) — selection lives with the caller.
 * @startingPoint section="Display" subtitle="Review table with selection" viewport="700x300"
 */
export interface DataColumn<T = any> {
  key: string;
  header: React.ReactNode;
  align?: "left" | "right" | "center";
  width?: string;
  render?: (row: T) => React.ReactNode;
}
export interface DataTableProps<T = any> extends React.HTMLAttributes<HTMLDivElement> {
  columns?: DataColumn<T>[];
  rows?: T[];
  selectable?: boolean;
  /** Indices of selected rows. */
  selected?: number[];
  onSelect?: (next: number[]) => void;
  onRowClick?: (row: T, index: number) => void;
  emptyLabel?: string;
}
export function DataTable(props: DataTableProps): JSX.Element;
