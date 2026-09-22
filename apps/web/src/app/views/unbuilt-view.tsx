import type { Screen, View } from "@/shared/screens.ts";

export function UnbuiltView(properties: { readonly screen: Screen; readonly view: View }) {
  return (
    <>
      <h1>{properties.screen.name}</h1>
      <p className="mt-2 text-muted-foreground">{properties.screen.summary}</p>
      <h2 className="mt-6">{properties.view.name}</h2>
      <p className="mt-2 border border-border bg-card p-4">This view is not built yet.</p>
    </>
  );
}
