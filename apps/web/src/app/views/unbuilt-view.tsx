import { UNBUILT_VIEW, unbuiltLineOf } from "@/app/words.ts";
import type { Screen, View } from "@/shared/screens.ts";

export function UnbuiltView(properties: { readonly screen: Screen; readonly view: View }) {
  const line = unbuiltLineOf(properties.screen);

  return (
    <>
      <h1>{properties.screen.name}</h1>
      {/* A role's home says one thing: its line stands in for the screen's lead line. */}
      {line === UNBUILT_VIEW ? (
        <p className="mt-2 text-muted-foreground">{properties.screen.summary}</p>
      ) : null}
      <h2 className="mt-6">{properties.view.name}</h2>
      <p className="mt-2 border border-border bg-card p-4">{line}</p>
    </>
  );
}
