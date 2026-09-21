import type { Screen } from "@/shared/screens.ts";

export function UnbuiltScreen(properties: { readonly screen: Screen }) {
  return (
    <>
      <h1>{properties.screen.name}</h1>
      <p className="mt-2 text-muted-foreground">{properties.screen.summary}</p>
      <p className="mt-6 border border-border bg-card p-4">This screen is not built yet.</p>
    </>
  );
}
