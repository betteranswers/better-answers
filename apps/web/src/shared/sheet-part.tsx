import { useId, type ReactNode } from "react";

/** One titled part of a sheet: a region a screen reader can jump to by its heading. */
export function SheetPart(properties: { readonly title: string; readonly children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="border border-border">
      <h3 id={headingId} className="border-b border-border px-4 py-2 font-medium">
        {properties.title}
      </h3>
      <div className="grid gap-3 px-4 py-3 text-sm">{properties.children}</div>
    </section>
  );
}
