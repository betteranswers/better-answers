import { useId, type ReactNode } from "react";

/** One titled part, a region a screen reader jumps to by its heading; its rule spans the part. */
export function SheetPart(properties: { readonly title: string; readonly children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="border border-border">
      <h3 id={headingId} className="max-w-none border-b border-border px-4 py-2 font-medium">
        {properties.title}
      </h3>
      <div className="grid gap-3 px-4 py-3 text-sm">{properties.children}</div>
    </section>
  );
}
