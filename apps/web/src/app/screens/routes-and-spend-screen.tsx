import { RoutesCard } from "@/features/routes/routes-card.tsx";
import { CONTROL_CENTRE, groupIn } from "@/shared/navigation.ts";
import { useOpenTab, type ScreenToolbar } from "@/shared/screen-toolbar.tsx";

const agentOperations = groupIn(CONTROL_CENTRE, "agent-operations");

const SPEND = "spend";

/**
 * Tabs divide this screen and nothing else, so the screen declares them and its route carries
 * them to the shell.
 */
export const ROUTES_AND_SPEND_TOOLBAR: ScreenToolbar = {
  tabs: [
    { id: "routes", name: "Routes" },
    { id: SPEND, name: "Spend" },
  ],
};

export function RoutesAndSpendScreen() {
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
