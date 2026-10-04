import { RoutesCard } from "@/features/routes/routes-card.tsx";
import { CONTROL_CENTRE, menuGroupIn } from "@/shared/navigation.ts";
import { useOpenTab, type PageToolbar } from "@/shared/page-toolbar.tsx";

const agentOperations = menuGroupIn(CONTROL_CENTRE, "agent-operations");

const SPEND = "spend";

/**
 * Tabs divide this page and nothing else, so the page declares them and its route carries
 * them to the shell.
 */
export const ROUTES_AND_SPEND_TOOLBAR: PageToolbar = {
  tabs: [
    { id: "routes", name: "Routes" },
    { id: SPEND, name: "Spend" },
  ],
};

export function RoutesAndSpendPage() {
  const open = useOpenTab();

  return (
    <>
      <h1>{agentOperations.name}</h1>
      <p className="mt-2 text-muted-foreground">{agentOperations.summary}</p>

      {open === SPEND ? (
        <p className="mt-6 border border-border bg-card p-4">Spend is not built yet.</p>
      ) : (
        <RoutesCard />
      )}
    </>
  );
}
