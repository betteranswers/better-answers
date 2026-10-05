import { ModelChoicesCard } from "@/features/model-choices/model-choices-card.tsx";
import { CONTROL_CENTRE, menuGroupIn } from "@/shared/navigation.ts";
import { useOpenTab, type PageToolbar } from "@/shared/page-toolbar.tsx";

const models = menuGroupIn(CONTROL_CENTRE, "models");

const SPEND = "spend";

/**
 * Tabs divide this page and nothing else, so the page declares them and its route carries
 * them to the shell.
 */
export const MODELS_AND_SPEND_TOOLBAR: PageToolbar = {
  tabs: [
    { id: "model-choices", name: "Model choices" },
    { id: SPEND, name: "Spend" },
  ],
};

export function ModelsAndSpendPage() {
  const open = useOpenTab();

  return (
    <>
      <h1>{models.name}</h1>
      <p className="mt-2 text-muted-foreground">{models.summary}</p>

      {open === SPEND ? (
        <p className="mt-6 border border-border bg-card p-4">Spend is not built yet.</p>
      ) : (
        <ModelChoicesCard />
      )}
    </>
  );
}
