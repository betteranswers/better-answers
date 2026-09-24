import { useId, useState, type ReactNode } from "react";

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

import { ActDialog } from "./act-dialog.tsx";
import { bindingHeadingId } from "./binding-list.tsx";
import { outcomeOfFailure, whyAndNextOf } from "./refusal.tsx";
import {
  CLASSES,
  EVERYONE,
  NARROWEST,
  useFindings,
  type ListedBinding,
  type Sensitivity,
} from "./sources-api.ts";
import { SummaryRow } from "./summary-row.tsx";
import { AUDIENCE_WORDS, AUDITED_CATEGORIES, counted, spokenWord } from "./words.ts";

type DialogProperties<Asked> = {
  readonly binding: ListedBinding;
  readonly onClose: () => void;
  readonly onConfirm: (asked: Asked) => void;
};

// The act's own row may lose the control that opened it, so focus goes back to the binding.
const toTheBinding = (bindingId: string) => (event: Event) => {
  event.preventDefault();
  document.getElementById(bindingHeadingId(bindingId))?.focus();
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

function TheAuditRow(properties: {
  readonly act: string;
  readonly binding: ListedBinding;
  readonly children: ReactNode;
}) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="font-medium">
        What the audit row will carry
      </h3>
      <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <SummaryRow term="Act">
          <span className="font-mono">{properties.act}</span>
        </SummaryRow>
        <SummaryRow term="Binding">{properties.binding.name}</SummaryRow>
        <SummaryRow term="By">You, at the instant the platform records it</SummaryRow>
        {properties.children}
      </dl>
    </section>
  );
}

function WhatTheRowCarries(properties: {
  readonly binding: ListedBinding;
  readonly ticked: ReadonlySet<Confirmation>;
}) {
  const findings = useFindings(properties.binding.bindingId);
  const totals = new Map<string, number>();
  for (const group of findings.data ?? []) {
    totals.set(group.category, (totals.get(group.category) ?? 0) + group.found);
  }

  return (
    <TheAuditRow act="sources.binding.published" binding={properties.binding}>
      <SummaryRow term="Class">{properties.binding.sensitivity}</SummaryRow>
      <SummaryRow term="Audience">{AUDIENCE_WORDS[properties.binding.audience]}</SummaryRow>
      {CONFIRMATIONS.map((confirmation) => (
        <SummaryRow key={confirmation.field} term={confirmation.said}>
          {properties.ticked.has(confirmation.field) ? "Confirmed" : "Not yet confirmed"}
        </SummaryRow>
      ))}
      {findings.data === undefined ? (
        <SummaryRow term="Findings">
          {findings.error === null ? "Still counting" : outcomeOfFailure(findings.error).words}
        </SummaryRow>
      ) : (
        AUDITED_CATEGORIES.map((category) => (
          <SummaryRow key={category} term={`Findings, ${spokenWord(category)}`}>
            {totals.get(category) ?? 0}
          </SummaryRow>
        ))
      )}
      <SummaryRow term="DPIA input">
        The hash of this binding's DPIA input, taken at the click
      </SummaryRow>
    </TheAuditRow>
  );
}

export function PublishDialog(properties: DialogProperties<Confirmations>) {
  const { binding, onClose, onConfirm } = properties;
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
        onCloseAutoFocus: toTheBinding(binding.bindingId),
      }}
      title={`Publish ${binding.name}`}
      consequence={`Its passages reach ${AUDIENCE_WORDS[binding.audience].toLowerCase()} at the class ${binding.sensitivity} the moment you publish. This screen cannot unpublish it.`}
      commit={
        <Button disabled={!allConfirmed} aria-describedby={hintId} onClick={confirm}>
          Publish {binding.name}
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

      <WhatTheRowCarries binding={binding} ticked={ticked} />

      <p id={hintId} className="text-sm text-muted-foreground">
        {allConfirmed
          ? "One governed write, audited under your name."
          : "Publishing needs all three confirmations."}
      </p>
    </ActDialog>
  );
}

const narrowerThan = (sensitivity: Sensitivity): readonly Sensitivity[] =>
  CLASSES.slice(0, CLASSES.indexOf(sensitivity));

export const movedWords = (moved: {
  readonly concepts: readonly string[];
  readonly compositions: readonly string[];
}): ReactNode => (
  <>
    {counted(moved.concepts.length, "concept", "concepts")} and{" "}
    {counted(moved.compositions.length, "composition", "compositions")} moved with it.
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
  const { binding, onClose, onConfirm } = properties;
  const narrower = narrowerThan(binding.sensitivity);
  const [sensitivity, setSensitivity] = useState<Sensitivity>(narrower[0] ?? NARROWEST);

  return (
    <ActDialog
      open
      onOpenChange={closedBy(onClose)}
      content={{ onCloseAutoFocus: toTheBinding(binding.bindingId) }}
      title={`Narrow ${binding.name}`}
      consequence="Every concept citing its documents, and every composition including one of those concepts, moves with it in the same act. A narrowing never widens; widening it back is an act of its own."
      commit={
        <Button
          onClick={() => {
            onConfirm(sensitivity);
          }}
        >
          Narrow {binding.name} to {sensitivity}
        </Button>
      }
    >
      <WordPicked label="Class" value={sensitivity} words={narrower} onPick={setSensitivity} />
      <p className="text-sm text-muted-foreground">
        It is {binding.sensitivity} now. Its audience stays{" "}
        {AUDIENCE_WORDS[binding.audience].toLowerCase()}.
      </p>
    </ActDialog>
  );
}

type Audience = ListedBinding["audience"];

export type Widening = { readonly sensitivity: Sensitivity; readonly audience: Audience };

const asWideOrWiderThan = (sensitivity: Sensitivity): readonly Sensitivity[] =>
  CLASSES.slice(CLASSES.indexOf(sensitivity));

// The dialog opens on a widening, so the one click it asks for is never refused as not wider.
const firstWidening = (binding: ListedBinding): Widening => {
  const wider = CLASSES[CLASSES.indexOf(binding.sensitivity) + 1];
  return wider === undefined
    ? { sensitivity: binding.sensitivity, audience: EVERYONE }
    : { sensitivity: wider, audience: binding.audience };
};

// The dialog offers no narrower class and no other groups, so a wider term is the whole question.
const asksWider = (binding: ListedBinding, asked: Widening): boolean =>
  CLASSES.indexOf(asked.sensitivity) > CLASSES.indexOf(binding.sensitivity) ||
  (asked.audience === EVERYONE && binding.audience !== EVERYONE);

const WIDENING_CONSEQUENCE = {
  published:
    "Its passages reach more readers the moment you widen it, and every concept citing its documents, and every composition including one, moves with it in the same act.",
  unpublished:
    "Nobody but an Admin reads it until you publish it, and the publish then releases the class you choose here.",
};

const ITS_OWN_CLASS_STANDS = "A document with a narrower class of its own keeps it.";

export const classAndAudienceWords = (widening: Widening): string =>
  `${widening.sensitivity} for ${AUDIENCE_WORDS[widening.audience].toLowerCase()}`;

export function WidenDialog(properties: DialogProperties<Widening>) {
  const { binding, onClose, onConfirm } = properties;
  const [asked, setAsked] = useState<Widening>(() => firstWidening(binding));
  const hintId = useId();
  const wider = asksWider(binding, asked);
  const publication = binding.publishedAt === null ? "unpublished" : "published";

  return (
    <ActDialog
      open
      onOpenChange={closedBy(onClose)}
      content={{
        className: "max-h-[calc(100vh-2rem)] overflow-y-auto",
        onCloseAutoFocus: toTheBinding(binding.bindingId),
      }}
      title={`Widen ${binding.name}`}
      consequence={`${WIDENING_CONSEQUENCE[publication]} ${ITS_OWN_CLASS_STANDS}`}
      commit={
        <Button
          disabled={!wider}
          aria-describedby={hintId}
          onClick={() => {
            onConfirm(asked);
          }}
        >
          Widen {binding.name} to {classAndAudienceWords(asked)}
        </Button>
      }
    >
      <WordPicked
        label="Class"
        value={asked.sensitivity}
        words={asWideOrWiderThan(binding.sensitivity)}
        onPick={(sensitivity) => {
          setAsked({ ...asked, sensitivity });
        }}
      />

      {binding.audience === EVERYONE ? null : (
        <WordPicked
          label="Audience"
          value={asked.audience}
          words={[binding.audience, EVERYONE]}
          said={(audience) => AUDIENCE_WORDS[audience]}
          onPick={(audience) => {
            setAsked({ ...asked, audience });
          }}
        />
      )}

      <p className="text-sm text-muted-foreground">
        It is {classAndAudienceWords(binding)} now
        {binding.audience === EVERYONE ? ", and no audience is wider." : "."}
      </p>

      <TheAuditRow act="sources.binding.widened" binding={binding}>
        <SummaryRow term="Class, from">{binding.sensitivity}</SummaryRow>
        <SummaryRow term="Class, to">{asked.sensitivity}</SummaryRow>
        <SummaryRow term="Audience, from">{AUDIENCE_WORDS[binding.audience]}</SummaryRow>
        <SummaryRow term="Audience, to">{AUDIENCE_WORDS[asked.audience]}</SummaryRow>
      </TheAuditRow>

      <p id={hintId} className="text-sm text-muted-foreground">
        {wider ? "One governed write, audited under your name." : whyAndNextOf("not-wider")}
      </p>
    </ActDialog>
  );
}
