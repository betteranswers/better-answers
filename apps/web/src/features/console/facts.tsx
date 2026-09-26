import type { ReactNode } from "react";

/** A summary list: each fact a term and its value, the terms in one column. */
export function Facts(properties: { readonly children: ReactNode }) {
  return (
    <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">{properties.children}</dl>
  );
}
