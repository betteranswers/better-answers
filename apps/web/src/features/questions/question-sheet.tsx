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

/** A closed flag has no sentence of its own, so each refusal shows its class's. */
const { outcomeOfFailure } = refusalsOf({});

const LINK = "font-medium text-brand underline underline-offset-4";

/** Its own row's button, which the sheet hands focus back to. */
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

function CloseActions(properties: { readonly onClose: (closedAs: FlagClosing) => void }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 font-medium">{WORDS.closeTheFlag}</legend>
      <div className="flex flex-wrap gap-2">
        {CLOSINGS.map((closing) => (
          <Button
            key={closing}
            variant="outline"
            size="sm"
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

const focusOnArrival = (line: HTMLElement | null): void => {
  line?.focus();
};

/** Given only where the reader may read the concept the sentence rested on; an erasure clears the sentence. */
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

/** Focus lands here once the flag it was closing is closed, since the buttons go with it. */
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
      {feedback.closedAt === null ? <CloseActions onClose={properties.onClose} /> : null}
    </li>
  );
}

function FeedbackPart(properties: { readonly record: AskedRecord }) {
  const { record } = properties;
  const closeFlag = useCloseFlag();
  const [outcome, setOutcome] = useState<Outcome>();
  const [landOn, setLandOn] = useState<string>();
  const flags = record.feedback.filter(isAFlag);
  const helpful = record.feedback.filter((feedback) => !isAFlag(feedback));
  if (record.feedback.length === 0) return null;

  const close = (feedbackId: string, closedAs: FlagClosing) => {
    setOutcome(undefined);
    setLandOn(feedbackId);
    closeFlag.mutate(
      { feedbackId, closedAs },
      {
        onSuccess: () => {
          setOutcome({ tone: "said", words: WORDS.closedSaid[closedAs] });
        },
        onError: (failure) => {
          setOutcome(outcomeOfFailure(failure, "action"));
        },
      },
    );
  };

  return (
    <SheetPart title={WORDS.parts.feedback}>
      <OutcomeLine outcome={outcome} />
      <ul className="grid gap-3">
        {flags.map((feedback) => (
          <FlagItem
            key={feedback.id}
            feedback={feedback}
            concepts={record.concepts}
            landsHere={landOn === feedback.id}
            onClose={(closedAs) => {
              close(feedback.id, closedAs);
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

/** One record over its list: what was asked, what `ask` gave, and the flags on it. */
export function QuestionSheet(properties: {
  readonly record: AskedRecord;
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
        <FeedbackPart record={record} />
        <AnswerPart record={record} />
        <ConceptsPart concepts={record.concepts} />
        <DraftedPart drafted={record.drafted} />
      </div>
    </RowSheet>
  );
}
