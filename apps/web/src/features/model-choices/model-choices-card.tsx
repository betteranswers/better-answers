import { useReadSaid } from "@/shared/read-said.ts";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";

import { useWorkspaceModelChoices, type WorkspaceModelChoice } from "./list-model-choices.ts";
import { MODEL_CHOICES_WORDS, providerWordOf } from "./words.ts";

const PURPOSE_NAMES = {
  extraction: "Extraction",
  enrichment: "Enrichment",
  answering: "Answering",
  judging: "Judging",
  embedding: "Embedding",
} as const satisfies Record<WorkspaceModelChoice["purpose"], string>;

const FIXED_PURPOSE: WorkspaceModelChoice["purpose"] = "embedding";

type SetModelChoice = WorkspaceModelChoice & { readonly provider: string; readonly model: string };

const isSet = (modelChoice: WorkspaceModelChoice): modelChoice is SetModelChoice =>
  modelChoice.provider !== null && modelChoice.model !== null;

function ModelChoiceFields(properties: { readonly modelChoice: WorkspaceModelChoice }) {
  const { modelChoice } = properties;
  if (!isSet(modelChoice))
    return <p className="mt-1 text-muted-foreground">{MODEL_CHOICES_WORDS.unset}</p>;
  const { provider, model } = modelChoice;
  return (
    <dl className="mt-1 flex flex-col gap-1 sm:flex-row sm:gap-8">
      <div className="flex gap-2">
        <dt className="text-muted-foreground">Provider</dt>
        <dd>{providerWordOf(provider)}</dd>
      </div>
      <div className="flex gap-2">
        <dt className="text-muted-foreground">Model</dt>
        <dd>{model}</dd>
      </div>
    </dl>
  );
}

/** Only an embedding model choice that exists is fixed, so a purpose with none carries no note. */
function FixedNote(properties: { readonly modelChoice: WorkspaceModelChoice }) {
  const { modelChoice } = properties;
  if (modelChoice.purpose !== FIXED_PURPOSE || !isSet(modelChoice)) return null;
  return (
    <>
      <p className="mt-2">
        <Pill>{MODEL_CHOICES_WORDS.fixed}</Pill>{" "}
        {modelChoice.dimensions === null ? null : (
          <span className="text-muted-foreground">{modelChoice.dimensions} dimensions</span>
        )}
      </p>
      <p className="mt-1 text-muted-foreground">{MODEL_CHOICES_WORDS.fixedReason}</p>
    </>
  );
}

function ModelChoiceRow(properties: { readonly modelChoice: WorkspaceModelChoice }) {
  const { modelChoice } = properties;
  return (
    <li className="border-t border-border py-3 first:border-t-0 first:pt-0">
      <h3 className="font-medium text-foreground">{PURPOSE_NAMES[modelChoice.purpose]}</h3>
      <ModelChoiceFields modelChoice={modelChoice} />
      <FixedNote modelChoice={modelChoice} />
    </li>
  );
}

/** With no model choice set, one line says so rather than five rows each saying it. */
function ModelChoiceList(properties: { readonly modelChoices: readonly WorkspaceModelChoice[] }) {
  if (!properties.modelChoices.some(isSet)) return <p>{MODEL_CHOICES_WORDS.noneSet}</p>;
  return (
    <ul>
      {properties.modelChoices.map((modelChoice) => (
        <ModelChoiceRow key={modelChoice.purpose} modelChoice={modelChoice} />
      ))}
    </ul>
  );
}

/** Said once for the card, however many purposes have no model choice. */
function WhoSets(properties: { readonly modelChoices: readonly WorkspaceModelChoice[] }) {
  if (properties.modelChoices.every(isSet)) return null;
  return <p className="text-muted-foreground">{MODEL_CHOICES_WORDS.whoSets}</p>;
}

export function ModelChoicesCard() {
  const modelChoices = useWorkspaceModelChoices();
  const said = useReadSaid(modelChoices);

  return (
    <Card asChild className="mt-6">
      <section aria-labelledby="model-choices">
        <CardHeader>
          <CardTitle asChild>
            <h2 id="model-choices">Model choices</h2>
          </CardTitle>
          <p className="text-muted-foreground">{MODEL_CHOICES_WORDS.lead}</p>
          {modelChoices.data === undefined ? null : <WhoSets modelChoices={modelChoices.data} />}
        </CardHeader>

        <CardContent aria-live="polite">
          {said.isPending ? <p>{MODEL_CHOICES_WORDS.loading}</p> : null}
          {said.error === null ? null : <p>{MODEL_CHOICES_WORDS.failed}</p>}
          {modelChoices.data === undefined ? null : (
            <ModelChoiceList modelChoices={modelChoices.data} />
          )}
        </CardContent>
      </section>
    </Card>
  );
}
