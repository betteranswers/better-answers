import { useId, useState, type ReactNode } from "react";

import { SummaryRow } from "@/shared/list/summary-row.tsx";
import { ActionDialog } from "@/shared/page/action-dialog.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Checkbox } from "@/shared/ui/checkbox.tsx";
import { Label } from "@/shared/ui/label.tsx";

import { connectedSourceHeadingId } from "./connected-source-list.tsx";
import { outcomeOfFailure } from "./refusal.tsx";
import { useFindings, type ListedConnectedSource } from "./sources-api.ts";
import {
  AUDIENCE_WORDS,
  AUDITED_CATEGORIES,
  OUTCOME_WORDS,
  PUBLISH_WORDS,
  sensitivityAndAudienceWords,
} from "./words.ts";

type DialogProperties = {
  readonly connectedSource: ListedConnectedSource;
  readonly onClose: () => void;
  readonly onConfirm: (confirmations: Confirmations) => void;
};

const toTheConnectedSource = (connectedSourceId: string) => (event: Event) => {
  event.preventDefault();
  document.getElementById(connectedSourceHeadingId(connectedSourceId))?.focus();
};

const closedBy = (onClose: () => void) => (open: boolean) => {
  if (!open) onClose();
};

const CONFIRMATIONS = (
  ["lawfulBasisRecorded", "privacyInformationUpdated", "dpiaReferenced"] as const
).map((field) => ({ field, said: PUBLISH_WORDS.confirmations[field] }));

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
        {PUBLISH_WORDS.audit}
      </h3>
      <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <SummaryRow term="Action">Connected source published</SummaryRow>
        <SummaryRow term={PUBLISH_WORDS.connectedSource}>
          {properties.connectedSource.name}
        </SummaryRow>
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
        <SummaryRow key={confirmation.field} term={confirmation.said}>
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
      <SummaryRow term={PUBLISH_WORDS.dpiaInput}>
        A hash of the DPIA input, taken when you publish
      </SummaryRow>
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
      title={PUBLISH_WORDS.named(connectedSource.name)}
      consequence={PUBLISH_WORDS.consequence(sensitivityAndAudienceWords(connectedSource))}
      commit={
        <Button
          disabled={!allConfirmed}
          aria-describedby={allConfirmed ? undefined : hintId}
          onClick={confirm}
        >
          Publish
        </Button>
      }
    >
      <fieldset className="grid gap-3">
        <legend className="mb-2 font-medium">{PUBLISH_WORDS.confirm}</legend>
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

      {allConfirmed ? null : (
        <p id={hintId} className="text-sm text-muted-foreground">
          {PUBLISH_WORDS.allRequired}
        </p>
      )}
    </ActionDialog>
  );
}

export const movedWords = (moved: {
  readonly concepts: readonly string[];
  readonly writeUps: readonly string[];
}): ReactNode => (
  <>
    {OUTCOME_WORDS.cited({ concepts: moved.concepts.length, writeUps: moved.writeUps.length })}
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
