import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { ulidOfConceptIri } from "@better-answers/schema/concept-file";

import { detailAt, KNOWLEDGE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { refusalsOf } from "@/shared/refusal-outcome.tsx";
import { RowSheet } from "@/shared/row-sheet.tsx";
import { SheetPart } from "@/shared/sheet-part.tsx";
import { SummaryRow as Row } from "@/shared/summary-row.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
import { SheetDescription, SheetHeader, SheetTitle } from "@/shared/ui/sheet.tsx";
import { instantWords, nameOrAddress } from "@/shared/words.ts";

import {
  isAFlag,
  useCloseFlag,
  type AskedRecord,
  type ConceptRead,
  type Feedback,
  type FlagClosing,
} from "./questions-api.ts";
import { CLOSE_AS, CLOSINGS, QUESTIONS_WORDS as WORDS, trustThenWords } from "./questions-words.ts";

const SEARCH_PAGE = pageNamed(menuGroupIn(KNOWLEDGE, "browse"), "Search");

const { outcomeOfFailure } = refusalsOf({});

const LINK = "font-medium text-brand underline underline-offset-4";

export const recordButtonId = (recordId: string): string => `question-${recordId.toLowerCase()}`;

export const askerWords = (askedBy: AskedRecord["askedBy"]): string =>
  askedBy.kind === "person"
    ? nameOrAddress(askedBy.displayName, askedBy.address)
    : WORDS.asker[askedBy.kind];

export const questionWords = (record: AskedRecord): string => record.question ?? WORDS.removed;

const conceptPageOf = (iri: string): string | undefined => {
  const ulid = ulidOfConceptIri(iri);
  return ulid === undefined ? undefined : detailAt(SEARCH_PAGE, ulid);
};

function ConceptTitle(properties: { readonly iri: string; readonly title: string }) {
  const page = conceptPageOf(properties.iri);
  return page === undefined ? (
    <span className="font-medium">{properties.title}</span>
  ) : (
    <Link to={page} className={LINK}>
      {properties.title}
    </Link>
  );
}

function ConceptItem(properties: { readonly concept: ConceptRead }) {
  const { concept } = properties;
  return (
    <li className="grid gap-1 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <ConceptTitle iri={concept.iri} title={concept.title} />
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        <Row term={WORDS.terms.kind}>{concept.kind}</Row>
        <Row term={WORDS.terms.collection}>{concept.collection ?? WORDS.noCollection}</Row>
        <Row term={WORDS.terms.trustThen}>
          <Pill>{trustThenWords(concept.trustThen)}</Pill>
        </Row>
        {concept.judged === undefined ? null : (
          <Row term={WORDS.terms.judged}>{WORDS.judged[concept.judged]}</Row>
        )}
      </dl>
    </li>
  );
}

function ConceptsPart(properties: { readonly concepts: readonly ConceptRead[] }) {
  const { concepts } = properties;
  return (
    <SheetPart title={WORDS.parts.concepts}>
      {concepts.length === 0 ? (
        <p className="text-muted-foreground">{WORDS.noConcepts}</p>
      ) : (
        <ul className="grid gap-3">
          {concepts.map((concept) => (
            <ConceptItem key={concept.iri} concept={concept} />
          ))}
        </ul>
      )}
    </SheetPart>
  );
}

function AnswerPart(properties: { readonly record: AskedRecord }) {
  const { record } = properties;
  return (
    <SheetPart title={WORDS.parts.answer}>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        <Row term={WORDS.terms.verdict}>
          <Pill>{WORDS.verdict(record.verdict)}</Pill>
        </Row>
        <Row term={WORDS.terms.judge}>{WORDS.judge(record.judgeState)}</Row>
        <Row term={WORDS.terms.collectionsNamed}>
          {record.collectionsNamed.length === 0
            ? WORDS.noneNamed
            : record.collectionsNamed.join(", ")}
        </Row>
      </dl>
    </SheetPart>
  );
}

function DraftedPart(properties: { readonly drafted: AskedRecord["drafted"] }) {
  const { drafted } = properties;
  if (drafted === null || drafted.length === 0) return null;
  return (
    <SheetPart title={WORDS.parts.drafted}>
      <div className="grid gap-2">
        {drafted.map((sentence, at) => (
          <p key={at}>{sentence.sentence}</p>
        ))}
      </div>
    </SheetPart>
  );
}

const focusOnArrival = (line: HTMLElement | null): void => {
  line?.focus();
};

function CloseActions(properties: {
  readonly pending: boolean;
  readonly landsHere: boolean;
  readonly onClose: (closedAs: FlagClosing) => void;
}) {
  const { pending, landsHere } = properties;
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 font-medium">{WORDS.closeTheFlag}</legend>
      <div className="flex flex-wrap gap-2">
        {CLOSINGS.map((closing, at) => (
          <Button
            key={closing}
            ref={at === 0 && landsHere && !pending ? focusOnArrival : undefined}
            variant="outline"
            size="sm"
            // Not `disabled`: a disabled button drops the focus the keyboard left on it.
            aria-disabled={pending ? true : undefined}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            onClick={() => {
              properties.onClose(closing);
            }}
          >
            {CLOSE_AS[closing]}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}

function DisputedRows(properties: {
  readonly disputed: Feedback["disputed"];
  readonly concepts: readonly ConceptRead[];
}) {
  const { disputed, concepts } = properties;
  if (disputed === undefined) return null;
  const restedOn = concepts.find((concept) => concept.iri === disputed.concept);
  return (
    <>
      {disputed.sentence === null ? null : (
        <Row term={WORDS.terms.disputed}>
          <blockquote className="border-l border-border bg-muted px-3 py-2">
            {disputed.sentence}
          </blockquote>
        </Row>
      )}
      <Row term={WORDS.terms.restedOn}>
        <ConceptTitle iri={disputed.concept} title={restedOn?.title ?? disputed.concept} />
      </Row>
    </>
  );
}

function ClosedRow(properties: { readonly feedback: Feedback; readonly landsHere: boolean }) {
  const { closedAs, closedAt } = properties.feedback;
  if (closedAs === null || closedAt === null) return null;
  return (
    <Row term={WORDS.terms.closed}>
      <span ref={properties.landsHere ? focusOnArrival : undefined} tabIndex={-1}>
        {WORDS.closing[closedAs]} · {instantWords(closedAt)}
      </span>
    </Row>
  );
}

function FlagItem(properties: {
  readonly feedback: Feedback;
  readonly concepts: readonly ConceptRead[];
  readonly landsHere: boolean;
  readonly pending: boolean;
  readonly onClose: (closedAs: FlagClosing) => void;
}) {
  const { feedback } = properties;
  return (
    <li className="grid gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <p className="font-medium">{WORDS.flaggedAs(feedback.reason)}</p>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        <Row term={WORDS.terms.given}>{instantWords(feedback.givenAt)}</Row>
        {feedback.note === null ? null : <Row term={WORDS.terms.note}>{feedback.note}</Row>}
        <DisputedRows disputed={feedback.disputed} concepts={properties.concepts} />
        <ClosedRow feedback={feedback} landsHere={properties.landsHere} />
      </dl>
      {feedback.closedAt === null ? (
        <CloseActions
          pending={properties.pending}
          landsHere={properties.landsHere}
          onClose={properties.onClose}
        />
      ) : null}
    </li>
  );
}

export type FlagClosingState = {
  readonly pending: boolean;
  readonly last: { readonly recordId: string; readonly feedbackId: string } | undefined;
  readonly outcome: Outcome | undefined;
  readonly close: (recordId: string, feedbackId: string, closedAs: FlagClosing) => void;
};

export const useFlagClosing = (): FlagClosingState => {
  const [last, setLast] = useState<FlagClosingState["last"]>();
  const [outcome, setOutcome] = useState<Outcome>();
  const closeFlag = useCloseFlag({
    onClosed: ({ closedAs }) => {
      setOutcome({ tone: "said", words: WORDS.closedSaid[closedAs] });
    },
    onRefused: (failure) => {
      setOutcome(outcomeOfFailure(failure, "action"));
    },
  });
  return {
    pending: closeFlag.isPending,
    last,
    outcome,
    close: (recordId, feedbackId, closedAs) => {
      if (closeFlag.isPending) return;
      setLast({ recordId, feedbackId });
      setOutcome(undefined);
      closeFlag.mutate({ feedbackId, closedAs });
    },
  };
};

function FeedbackPart(properties: {
  readonly record: AskedRecord;
  readonly closing: FlagClosingState;
}) {
  const { record, closing } = properties;
  if (record.feedback.length === 0) return null;
  const flags = record.feedback.filter(isAFlag);
  const helpful = record.feedback.filter((feedback) => !isAFlag(feedback));
  const closingHere = closing.last?.recordId === record.id ? closing.last : undefined;

  return (
    <SheetPart title={WORDS.parts.feedback}>
      <OutcomeLine outcome={closingHere === undefined ? undefined : closing.outcome} />
      <ul className="grid gap-3">
        {flags.map((feedback) => (
          <FlagItem
            key={feedback.id}
            feedback={feedback}
            concepts={record.concepts}
            landsHere={closingHere?.feedbackId === feedback.id}
            pending={closing.pending}
            onClose={(closedAs) => {
              closing.close(record.id, feedback.id, closedAs);
            }}
          />
        ))}
        {helpful.map((feedback) => (
          <li key={feedback.id} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
            {WORDS.helpful} · {instantWords(feedback.givenAt)}
          </li>
        ))}
      </ul>
    </SheetPart>
  );
}

function AskedLine(properties: { readonly record: AskedRecord }) {
  const { record } = properties;
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
      <Row term={WORDS.terms.askedBy}>{askerWords(record.askedBy)}</Row>
      <Row term={WORDS.terms.where}>{WORDS.where[record.transport]}</Row>
      <Row term={WORDS.terms.asked}>{instantWords(record.askedAt)}</Row>
    </dl>
  );
}

export function QuestionSheet(properties: {
  readonly record: AskedRecord;
  readonly closing: FlagClosingState;
  readonly onClose: () => void;
}) {
  const { record } = properties;
  const titleRef = useRef<HTMLHeadingElement>(null);
  return (
    <RowSheet
      rowButtonId={recordButtonId(record.id)}
      onOpen={() => {
        titleRef.current?.focus();
      }}
      onClose={properties.onClose}
    >
      <SheetHeader className="border-b border-border">
        <SheetTitle asChild>
          <h2 ref={titleRef} tabIndex={-1} className="pr-8 wrap-anywhere">
            {questionWords(record)}
          </h2>
        </SheetTitle>
        <SheetDescription asChild>
          <div>
            <AskedLine record={record} />
          </div>
        </SheetDescription>
      </SheetHeader>
      <div className="grid gap-4 px-4 pb-4">
        <FeedbackPart record={record} closing={properties.closing} />
        <AnswerPart record={record} />
        <ConceptsPart concepts={record.concepts} />
        <DraftedPart drafted={record.drafted} />
      </div>
    </RowSheet>
  );
}
