import { useId, useState, type ReactNode } from "react";

import { ActDialog } from "@/shared/act-dialog.tsx";
import { SummaryRow } from "@/shared/summary-row.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Checkbox } from "@/shared/ui/checkbox.tsx";
import { Label } from "@/shared/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select.tsx";
import { counted } from "@/shared/words.ts";

import { connectedSourceHeadingId } from "./connected-source-list.tsx";
import { outcomeOfFailure, whyAndNextOf } from "./refusal.tsx";
import {
  SENSITIVITIES,
  EVERYONE,
  NARROWEST,
  useFindings,
  type ListedConnectedSource,
  type Sensitivity,
} from "./sources-api.ts";
import { AUDIENCE_WORDS, AUDITED_CATEGORIES, spokenWord } from "./words.ts";

type DialogProperties<Asked> = {
  readonly connectedSource: ListedConnectedSource;
  readonly onClose: () => void;
  readonly onConfirm: (asked: Asked) => void;
};

/** The act's own row may lose the control that opened it, so focus goes back to the connected source. */
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
  widened: "Connected source widened",
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
        The hash of this connected source's DPIA input, taken at the click
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
    <ActDialog
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
    </ActDialog>
  );
}

const narrowerThan = (sensitivity: Sensitivity): readonly Sensitivity[] =>
  SENSITIVITIES.slice(0, SENSITIVITIES.indexOf(sensitivity));

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

function WordPicked<Word extends string>(properties: {
  readonly label: string;
  readonly value: Word;
  readonly words: readonly Word[];
  readonly said?: (word: Word) => string;
  readonly onPick: (word: Word) => void;
}) {
  const { words, said = (word) => word } = properties;
  const id = useId();

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{properties.label}</Label>
      <Select
        value={properties.value}
        onValueChange={(value) => {
          const picked = words.find((word) => word === value);
          if (picked !== undefined) properties.onPick(picked);
        }}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {words.map((word) => (
            <SelectItem key={word} value={word}>
              {said(word)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function NarrowDialog(properties: DialogProperties<Sensitivity>) {
  const { connectedSource, onClose, onConfirm } = properties;
  const narrower = narrowerThan(connectedSource.sensitivity);
  const [sensitivity, setSensitivity] = useState<Sensitivity>(narrower[0] ?? NARROWEST);

  return (
    <ActDialog
      open
      onOpenChange={closedBy(onClose)}
      content={{ onCloseAutoFocus: toTheConnectedSource(connectedSource.connectedSourceId) }}
      title={`Narrow ${connectedSource.name}`}
      consequence="Every concept citing its documents, and every write-up including one of those concepts, moves with it in the same act. A narrowing never widens; widening it back is an act of its own."
      commit={
        <Button
          onClick={() => {
            onConfirm(sensitivity);
          }}
        >
          Narrow {connectedSource.name} to {sensitivity}
        </Button>
      }
    >
      <WordPicked
        label="Sensitivity"
        value={sensitivity}
        words={narrower}
        onPick={setSensitivity}
      />
      <p className="text-sm text-muted-foreground">
        It is {connectedSource.sensitivity} now. Its audience stays{" "}
        {AUDIENCE_WORDS[connectedSource.audience].toLowerCase()}.
      </p>
    </ActDialog>
  );
}

type Audience = ListedConnectedSource["audience"];

export type Widening = { readonly sensitivity: Sensitivity; readonly audience: Audience };

const asWideOrWiderThan = (sensitivity: Sensitivity): readonly Sensitivity[] =>
  SENSITIVITIES.slice(SENSITIVITIES.indexOf(sensitivity));

/** The dialog opens on a widening, so the one click it asks for is never refused as not wider. */
const firstWidening = (connectedSource: ListedConnectedSource): Widening => {
  const wider = SENSITIVITIES[SENSITIVITIES.indexOf(connectedSource.sensitivity) + 1];
  return wider === undefined
    ? { sensitivity: connectedSource.sensitivity, audience: EVERYONE }
    : { sensitivity: wider, audience: connectedSource.audience };
};

/**
 * The dialog offers no narrower sensitivity and no other groups, so a wider term is the whole
 * question.
 */
const asksWider = (connectedSource: ListedConnectedSource, asked: Widening): boolean =>
  SENSITIVITIES.indexOf(asked.sensitivity) > SENSITIVITIES.indexOf(connectedSource.sensitivity) ||
  (asked.audience === EVERYONE && connectedSource.audience !== EVERYONE);

const WIDENING_CONSEQUENCE = {
  published:
    "Its passages reach more readers the moment you widen it, and every concept citing its documents, and every write-up including one, moves with it in the same act.",
  unpublished:
    "Nobody but an Admin reads it until you publish it, and the publish then releases the sensitivity you choose here.",
};

const ITS_OWN_SENSITIVITY_STANDS = "A document with a narrower sensitivity of its own keeps it.";

export const sensitivityAndAudienceWords = (widening: Widening): string =>
  `${widening.sensitivity} for ${AUDIENCE_WORDS[widening.audience].toLowerCase()}`;

export function WidenDialog(properties: DialogProperties<Widening>) {
  const { connectedSource, onClose, onConfirm } = properties;
  const [asked, setAsked] = useState<Widening>(() => firstWidening(connectedSource));
  const hintId = useId();
  const wider = asksWider(connectedSource, asked);
  const publication = connectedSource.publishedAt === null ? "unpublished" : "published";

  return (
    <ActDialog
      open
      onOpenChange={closedBy(onClose)}
      content={{
        className: "max-h-[calc(100vh-2rem)] overflow-y-auto",
        onCloseAutoFocus: toTheConnectedSource(connectedSource.connectedSourceId),
      }}
      title={`Widen ${connectedSource.name}`}
      consequence={`${WIDENING_CONSEQUENCE[publication]} ${ITS_OWN_SENSITIVITY_STANDS}`}
      commit={
        <Button
          disabled={!wider}
          aria-describedby={hintId}
          onClick={() => {
            onConfirm(asked);
          }}
        >
          Widen {connectedSource.name} to {sensitivityAndAudienceWords(asked)}
        </Button>
      }
    >
      <WordPicked
        label="Sensitivity"
        value={asked.sensitivity}
        words={asWideOrWiderThan(connectedSource.sensitivity)}
        onPick={(sensitivity) => {
          setAsked({ ...asked, sensitivity });
        }}
      />

      {connectedSource.audience === EVERYONE ? null : (
        <WordPicked
          label="Audience"
          value={asked.audience}
          words={[connectedSource.audience, EVERYONE]}
          said={(audience) => AUDIENCE_WORDS[audience]}
          onPick={(audience) => {
            setAsked({ ...asked, audience });
          }}
        />
      )}

      <p className="text-sm text-muted-foreground">
        It is {sensitivityAndAudienceWords(connectedSource)} now
        {connectedSource.audience === EVERYONE ? ", and no audience is wider." : "."}
      </p>

      <TheAuditRow action="widened" connectedSource={connectedSource}>
        <SummaryRow term="Sensitivity, from">{connectedSource.sensitivity}</SummaryRow>
        <SummaryRow term="Sensitivity, to">{asked.sensitivity}</SummaryRow>
        <SummaryRow term="Audience, from">{AUDIENCE_WORDS[connectedSource.audience]}</SummaryRow>
        <SummaryRow term="Audience, to">{AUDIENCE_WORDS[asked.audience]}</SummaryRow>
      </TheAuditRow>

      <p id={hintId} className="text-sm text-muted-foreground">
        {wider ? "One governed write, audited under your name." : whyAndNextOf("not-wider")}
      </p>
    </ActDialog>
  );
}
