import { useId, type ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card.tsx";

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
