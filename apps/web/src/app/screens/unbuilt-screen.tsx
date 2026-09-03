import type { Screen } from "@/shared/screens.ts";

/**
 * A screen the product names but has not built. It says so, rather than showing an empty
 * table a reader would read as "this workspace has none" — the platform states what is
 * true and what is not (`[UX1]`, the design system's tone rules).
 *
 * WCAG 2.2 AA, tested with a keyboard and a screen reader (`[A11Y1]`).
 */
export function UnbuiltScreen(properties: { readonly screen: Screen }) {
  return (
    <>
      <h1>{properties.screen.name}</h1>
      <p className="mt-2 text-muted-foreground">{properties.screen.summary}</p>
      <p className="mt-6 border border-border bg-card p-4">This screen is not built yet.</p>
    </>
  );
}
