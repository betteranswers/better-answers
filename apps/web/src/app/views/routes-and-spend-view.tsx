import { RoutesCard } from "@/features/routes/routes-card.tsx";
import { screenById } from "@/shared/screens.ts";
import { useOpenTab, type ViewToolbar } from "@/shared/view-toolbar.tsx";

const system = screenById("system");

const SPEND = "spend";

/**
 * Tabs divide this view and nothing else, so the view declares them and its route carries
 * them to the shell.
 */
export const ROUTES_AND_SPEND_TOOLBAR: ViewToolbar = {
  tabs: [
    { id: "routes", name: "Routes" },
    { id: SPEND, name: "Spend" },
  ],
};

export function RoutesAndSpendView() {
  const open = useOpenTab();

  return (
    <>
      <h1>{system.name}</h1>
      <p className="mt-2 text-muted-foreground">{system.summary}</p>

      {open === SPEND ? (
        <p className="mt-6 border border-border bg-card p-4">Spend is not built yet.</p>
      ) : (
        <RoutesCard />
      )}

      <p className="mt-6 text-muted-foreground">
        The rest of System — boxes, backups, sources and worker, the map, knowledge, questions,
        connected clients and personal data — is not built yet.
      </p>
    </>
  );
}
