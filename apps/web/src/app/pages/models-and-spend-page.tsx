import { ModelChoicesCard } from "@/features/model-choices/model-choices-card.tsx";
import { CONTROL_CENTRE, menuGroupIn } from "@/shared/navigation.ts";
import { PageHead } from "@/shared/page/page-head.tsx";
import { useOpenTab, type PageToolbar } from "@/shared/page/page-toolbar.tsx";
import { Card } from "@/shared/ui/card.tsx";

const models = menuGroupIn(CONTROL_CENTRE, "models");

const SPEND = "spend";

export const MODELS_AND_SPEND_TOOLBAR: PageToolbar = {
  tabs: [
    { id: "model-choices", name: "Model Choices" },
    { id: SPEND, name: "Spend" },
  ],
};

export function ModelsAndSpendPage() {
  const open = useOpenTab();

  return (
    <>
      <PageHead heading={models.name} summary={models.summary} />

      {open === SPEND ? (
        <Card asChild className="mt-6 p-4">
          <p>Spend is coming soon.</p>
        </Card>
      ) : (
        <ModelChoicesCard />
      )}
    </>
  );
}
