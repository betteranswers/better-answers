import { unbuiltLineOf } from "@/app/words.ts";
import { ASK, headingOf, type Page } from "@/shared/navigation.ts";

import { ConnectAssistant } from "./connect-assistant.tsx";

/** Only a role's home is routed while unbuilt, so its line and Ask's way to connect are all it says. */
export function UnbuiltPage(properties: { readonly home: Page }) {
  return (
    <>
      <h1>{headingOf(properties.home)}</h1>
      <p className="mt-2 border border-border bg-card p-4">{unbuiltLineOf(properties.home)}</p>
      {properties.home === ASK.home ? <ConnectAssistant /> : null}
    </>
  );
}
