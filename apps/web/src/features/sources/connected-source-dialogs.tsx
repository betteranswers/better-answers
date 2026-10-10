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
import { AUDIENCE_WORDS, AUDITED_CATEGORIES, spokenWord } from "./words.ts";

type DialogProperties<Asked> = {
  readonly connectedSource: ListedConnectedSource;
  readonly onClose: () => void;
  readonly onConfirm: (asked: Asked) => void;
};

/** The action's own row may lose the control that opened it, so focus goes back to the connected source. */
const toTheConnectedSource = (connectedSourceId: string) => (event: Event) => {
  event.preventDefault();
  document.getElementById(connectedSourceHeadingId(connectedSourceId))?.focus();
};

const closedBy = (onClose: () => void) => (open: boolean) => {
  if (!open) onClose();
};

const CONFIRMATIONS = [
  { field: "lawfulBasisRecorded", said: "Lawful basis recorded" },
  { field: "privacyInformationUpdated", said: "Privacy information updated" },
  { field: "dpiaReferenced", said: "DPIA reference recorded" },
] as const;

type Confirmation = (typeof CONFIRMATIONS)[number]["field"];

type Confirmations = Readonly<Record<Confirmation, boolean>>;

/** What the Audit log will call each action, in the words it shows there. */
const ACTION_WORDS = {
  published: "Connected source published",
} as const;

function TheAuditRow(properties: {
  readonly action: keyof typeof ACTION_WORDS;
  readonly connectedSource: ListedConnectedSource;
  readonly children: ReactNode;
}) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="font-medium">
        What the audit row will carry
      </h3>
      <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <SummaryRow term="Action">{ACTION_WORDS[properties.action]}</SummaryRow>
        <SummaryRow term="Connected source">{properties.connectedSource.name}</SummaryRow>
        <SummaryRow term="By">You, at the instant the platform records it</SummaryRow>
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
    <TheAuditRow action="published" connectedSource={properties.connectedSource}>
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
        AUDITED_CATEGORIES.map((category) => (
          <SummaryRow key={category} term={`Findings, ${spokenWord(category)}`}>
            {totals.get(category) ?? 0}
          </SummaryRow>
        ))
      )}
      <SummaryRow term="DPIA input">
        The hash of this connected source’s DPIA input, taken at the click
      </SummaryRow>
    </TheAuditRow>
  );
}

export function PublishDialog(properties: DialogProperties<Confirmations>) {
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
      consequence={`Its passages reach ${AUDIENCE_WORDS[connectedSource.audience].toLowerCase()} at the sensitivity ${connectedSource.sensitivity} the moment you publish. This page cannot unpublish it.`}
      commit={
        <Button disabled={!allConfirmed} aria-describedby={hintId} onClick={confirm}>
          Publish {connectedSource.name}
        </Button>
      }
    >
      <fieldset className="grid gap-3">
        <legend className="mb-2 font-medium">Confirm each before publishing</legend>
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
          ? "One governed write, audited under your name."
          : "Publishing needs all three confirmations."}
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
    {counted(moved.writeUps.length, "write-up", "write-ups")} moved with it.
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
