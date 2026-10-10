import { useId, type ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card.tsx";

/** One titled part, a region a screen reader jumps to by its heading; its rule spans the part. */
export function SheetPart(properties: { readonly title: string; readonly children: ReactNode }) {
  const headingId = useId();
  return (
    <Card asChild>
      <section aria-labelledby={headingId}>
        <CardHeader className="border-b py-2">
          <CardTitle asChild className="max-w-none font-medium">
            <h3 id={headingId}>{properties.title}</h3>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 py-3 text-sm">{properties.children}</CardContent>
      </section>
    </Card>
  );
}
