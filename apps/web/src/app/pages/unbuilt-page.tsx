import { unbuiltLineOf } from "@/app/words.ts";
import { headingOf, type Page } from "@/shared/navigation.ts";

/** Only a role's home is routed while unbuilt, so its line is all it has to say. */
export function UnbuiltPage(properties: { readonly home: Page }) {
  return (
    <>
      <h1>{headingOf(properties.home)}</h1>
      <p className="mt-2 border border-border bg-card p-4">{unbuiltLineOf(properties.home)}</p>
    </>
  );
}
