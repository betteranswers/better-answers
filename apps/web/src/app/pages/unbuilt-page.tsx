import { unbuiltLineOf } from "@/app/words.ts";
import { ASK, headingOf, type Page } from "@/shared/navigation.ts";
import { Card } from "@/shared/ui/card.tsx";

import { ConnectAssistant } from "./connect-assistant.tsx";

/** Only a role's home is routed while unbuilt, so its line and Ask's way to connect are all it says. */
export function UnbuiltPage(properties: { readonly home: Page }) {
  return (
    <>
      <h1>{headingOf(properties.home)}</h1>
      <Card asChild className="mt-2 p-4">
        <p>{unbuiltLineOf(properties.home)}</p>
      </Card>
      {properties.home === ASK.home ? <ConnectAssistant /> : null}
    </>
  );
}
