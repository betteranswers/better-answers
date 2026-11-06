import { UNBUILT_LINE } from "@/app/words.ts";
import type { Page } from "@/shared/navigation.ts";
import { PageHead } from "@/shared/page/page-head.tsx";
import { Card } from "@/shared/ui/card.tsx";

export function UnbuiltPage(properties: { readonly home: Page }) {
  return (
    <>
      <PageHead title={properties.home.name} />
      <Card asChild className="mt-2 p-4">
        <p>{UNBUILT_LINE}</p>
      </Card>
    </>
  );
}
