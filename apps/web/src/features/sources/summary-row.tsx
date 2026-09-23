import type { ReactNode } from "react";

export function SummaryRow(properties: { readonly term: string; readonly children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{properties.term}</dt>
      <dd>{properties.children}</dd>
    </div>
  );
}
