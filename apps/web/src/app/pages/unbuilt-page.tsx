import { UNBUILT_LINE } from "@/app/words.ts";
import { headingOf, type Page } from "@/shared/navigation.ts";
import { Card } from "@/shared/ui/card.tsx";

/** Only a role's home is routed while unbuilt, so its line is all it says. */
export function UnbuiltPage(properties: { readonly home: Page }) {
  return (
    <>
      <h1>{headingOf(properties.home)}</h1>
      <Card asChild className="mt-2 p-4">
        <p>{UNBUILT_LINE}</p>
      </Card>
    </>
  );
}
