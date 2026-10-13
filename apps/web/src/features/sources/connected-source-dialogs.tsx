import { useId, useState, type ReactNode } from "react";

import { ActionDialog } from "@/shared/action-dialog.tsx";
import { SummaryRow } from "@/shared/summary-row.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Checkbox } from "@/shared/ui/checkbox.tsx";
import { Label } from "@/shared/ui/label.tsx";
import { counted } from "@/shared/words.ts";

import { connectedSourceHeadingId } from "./connected-source-list.tsx";
import { outcomeOfFailure } from "./refusal.tsx";
import { useFindings, type ListedConnectedSource } from "./sources-api.ts";
import { AUDIENCE_WORDS, AUDITED_CATEGORIES, sensitivityAndAudienceWords } from "./words.ts";

type DialogProperties = {
  readonly connectedSource: ListedConnectedSource;
  readonly onClose: () => void;
  readonly onConfirm: (confirmations: Confirmations) => void;
};

/** The action's own row may lose the control that opened it, so focus goes back to the connected source. */
const toTheConnectedSource = (connectedSourceId: string) => (event: Event) => {
  event.preventDefault();
  document.getElementById(connectedSourceHeadingId(connectedSourceId))?.focus();
};

const closedBy = (onClose: () => void) => (open: boolean) => {
  if (!open) onClose();
};

/** `said` is the tick box's label and `term` the same words as the audit summary's term. */
const CONFIRMATIONS = [
  { field: "lawfulBasisRecorded", said: "Lawful basis recorded", term: "Lawful Basis Recorded" },
  {
    field: "privacyInformationUpdated",
    said: "Privacy information updated",
    term: "Privacy Information Updated",
  },
  { field: "dpiaReferenced", said: "DPIA reference recorded", term: "DPIA Reference Recorded" },
] as const;

type Confirmation = (typeof CONFIRMATIONS)[number]["field"];

type Confirmations = Readonly<Record<Confirmation, boolean>>;

function TheAuditRow(properties: {
  readonly connectedSource: ListedConnectedSource;
  readonly children: ReactNode;
}) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="font-medium">
        What the Audit Log Will Record
      </h3>
      <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <SummaryRow term="Action">Connected source published</SummaryRow>
        <SummaryRow term="Connected Source">{properties.connectedSource.name}</SummaryRow>
        <SummaryRow term="By">You, when you publish</SummaryRow>
        {properties.children}
      </dl>
    </section>
  );
}

function WhatTheRowCarries(properties: {
  readonly connectedSource: ListedConnectedSource;
  readonly ticked: ReadonlySet<Confirmation>;
}) {
  const findings = useFindings(properties.connectedSource.connectedSourceId);
  const totals = new Map<string, number>();
  for (const group of findings.data ?? []) {
    totals.set(group.category, (totals.get(group.category) ?? 0) + group.found);
  }

  return (
    <TheAuditRow connectedSource={properties.connectedSource}>
      <SummaryRow term="Sensitivity">{properties.connectedSource.sensitivity}</SummaryRow>
      <SummaryRow term="Audience">{AUDIENCE_WORDS[properties.connectedSource.audience]}</SummaryRow>
      {CONFIRMATIONS.map((confirmation) => (
        <SummaryRow key={confirmation.field} term={confirmation.term}>
          {properties.ticked.has(confirmation.field) ? "Confirmed" : "Not yet confirmed"}
        </SummaryRow>
      ))}
      {findings.data === undefined ? (
        <SummaryRow term="Findings">
          {findings.error === null
            ? "Still counting"
            : outcomeOfFailure(findings.error, "read").words}
        </SummaryRow>
      ) : (
        AUDITED_CATEGORIES.map(({ category, term }) => (
          <SummaryRow key={category} term={term}>
            {totals.get(category) ?? 0}
          </SummaryRow>
        ))
      )}
      <SummaryRow term="DPIA Input">A hash of the DPIA input, taken when you publish</SummaryRow>
    </TheAuditRow>
  );
}

export function PublishDialog(properties: DialogProperties) {
  const { connectedSource, onClose, onConfirm } = properties;
  const [ticked, setTicked] = useState<ReadonlySet<Confirmation>>(new Set());
  const hintId = useId();
  const allConfirmed = CONFIRMATIONS.every((confirmation) => ticked.has(confirmation.field));

  const confirm = () => {
    onConfirm({
      lawfulBasisRecorded: ticked.has("lawfulBasisRecorded"),
      privacyInformationUpdated: ticked.has("privacyInformationUpdated"),
      dpiaReferenced: ticked.has("dpiaReferenced"),
    });
  };

  return (
    <ActionDialog
      open
      onOpenChange={closedBy(onClose)}
      content={{
        className: "max-h-[calc(100vh-2rem)] overflow-y-auto",
        onCloseAutoFocus: toTheConnectedSource(connectedSource.connectedSourceId),
      }}
      title={`Publish ${connectedSource.name}`}
      consequence={`It will be published as ${sensitivityAndAudienceWords(connectedSource)}. This action cannot be undone.`}
      commit={
        <Button disabled={!allConfirmed} aria-describedby={hintId} onClick={confirm}>
          Publish
        </Button>
      }
    >
      <fieldset className="grid gap-3">
        <legend className="mb-2 font-medium">Confirm Before Publishing</legend>
        {CONFIRMATIONS.map((confirmation) => (
          <div key={confirmation.field} className="flex items-center gap-2">
            <Checkbox
              id={`${hintId}-${confirmation.field}`}
              checked={ticked.has(confirmation.field)}
              onCheckedChange={(checked) => {
                const next = new Set(ticked);
                if (checked === true) next.add(confirmation.field);
                else next.delete(confirmation.field);
                setTicked(next);
              }}
            />
            <Label htmlFor={`${hintId}-${confirmation.field}`}>{confirmation.said}</Label>
          </div>
        ))}
      </fieldset>

      <WhatTheRowCarries connectedSource={connectedSource} ticked={ticked} />

      <p id={hintId} className="text-sm text-muted-foreground">
        {allConfirmed
          ? "This will be recorded in the audit log."
          : "All three confirmations are required."}
      </p>
    </ActionDialog>
  );
}

export const movedWords = (moved: {
  readonly concepts: readonly string[];
  readonly writeUps: readonly string[];
}): ReactNode => (
  <>
    {counted(moved.concepts.length, "concept", "concepts")} and{" "}
    {counted(moved.writeUps.length, "write-up", "write-ups")} were updated with it.
    {moved.concepts.length === 0 ? null : (
      <span className="block">
        Concepts:{" "}
        {moved.concepts.map((iri, index) => (
          <span key={iri}>
            {index === 0 ? "" : ", "}
            <span className="font-mono">{iri}</span>
          </span>
        ))}
      </span>
    )}
  </>
);
