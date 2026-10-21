import { Link, useNavigate } from "@tanstack/react-router";
import { useId, useMemo, useRef, type ReactElement, type RefObject } from "react";

import { flaggedWords, verdictWords } from "@/shared/answer-words.ts";
import { refusalOf, type ApiError } from "@/shared/api/trpc.ts";
import { useBreadcrumbLastPart } from "@/shared/breadcrumb-last-part.ts";
import { RowLink } from "@/shared/grid-table.tsx";
import { usePageKeystrokes } from "@/shared/keystrokes.tsx";
import { useLanding, useLandingLine, type Landing } from "@/shared/landing.ts";
import { cn } from "@/shared/lib/utils.ts";
import { ListPages, ListRead, ListState } from "@/shared/list-pages.tsx";
import { ASK, detailAt, headingOf, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import { ListHead, PageHead } from "@/shared/page-head.tsx";
import { refusalsOf } from "@/shared/refusal-outcome.tsx";
import { SummaryRow as Row } from "@/shared/summary-row.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Card } from "@/shared/ui/card.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
import { instantWords } from "@/shared/words.ts";

import { AnswerView } from "./answer-view.tsx";
import { useYourQuestions, useYourRecord, type YourQuestions, type YourRecord } from "./ask-api.ts";
import { YOUR_QUESTIONS_KEYSTROKES as KEY } from "./ask-state.ts";
import { YOUR_QUESTIONS_WORDS as WORDS } from "./ask-words.ts";
import { shownAnswerOf } from "./shown-answer.ts";

const ASKING = menuGroupIn(ASK, "ask");

const YOUR_QUESTIONS = pageNamed(ASKING, "Your Questions");

const NEW_QUESTION = pageNamed(ASKING, "New Question");

const LISTED = Object.values(KEY);

const { outcomeOfFailure } = refusalsOf({});

const questionOf = (record: YourRecord): string => record.question ?? WORDS.removed;

const namesNoRecord = (failure: Error | ApiError): boolean =>
  refusalOf(failure)?.word === "not-found";

function QuestionRow(properties: {
  readonly record: YourRecord;
  readonly landsHere: boolean;
  readonly landing: Landing;
}) {
  const { record, landsHere, landing } = properties;
  const navigate = useNavigate();
  const land = useLandingLine(landsHere, landing.landed);
  const href = detailAt(YOUR_QUESTIONS, record.id);
  return (
    <li className="grid justify-items-start gap-1 border-t border-border px-3 py-3 first:border-t-0">
      <RowLink
        ref={land}
        href={href}
        className={cn(record.question === null && "text-muted-foreground")}
        onOpen={() => {
          void navigate({ href });
        }}
      >
        {questionOf(record)}
      </RowLink>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
        <Pill>{verdictWords(record.verdict)}</Pill>
        <span>{instantWords(record.askedAt)}</span>
      </div>
    </li>
  );
}

function AskOne() {
  return (
    <Button asChild variant="outline">
      <Link to={NEW_QUESTION.path}>{NEW_QUESTION.name}</Link>
    </Button>
  );
}

function Questions(properties: { readonly yours: YourQuestions }) {
  const { yours } = properties;
  const records = useMemo(
    () => yours.data?.pages.flatMap((page) => page.records) ?? [],
    [yours.data],
  );
  const landing = useLanding();

  if (records.length === 0) {
    return <ListState state={{ kind: "empty", words: WORDS.none, action: <AskOne /> }} />;
  }
  return (
    <>
      <ul>
        {records.map((record, at) => (
          <QuestionRow
            key={record.id}
            record={record}
            landsHere={at === landing.landAt}
            landing={landing}
          />
        ))}
      </ul>
      <ListPages
        pages={{
          kind: "more",
          label: WORDS.more,
          more: yours.hasNextPage,
          loading: yours.isFetchingNextPage,
          failed: yours.isFetchNextPageError
            ? outcomeOfFailure(yours.error, "read").words
            : undefined,
          onMore: () => {
            landing.landOn(records.length);
            void yours.fetchNextPage();
          },
          keystroke: KEY.more,
        }}
      />
    </>
  );
}

export function YourQuestionsPage() {
  usePageKeystrokes(LISTED);
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const yours = useYourQuestions();

  return (
    <>
      <PageHead heading={headingOf(YOUR_QUESTIONS)} />
      <section aria-labelledby={headingId} className="mt-6">
        <ListHead
          heading={YOUR_QUESTIONS.name}
          headingId={headingId}
          headingRef={headingRef}
          count=""
        />
        <Card className="mt-4 gap-0 py-0">
          <ListRead
            read={{
              error: yours.data === undefined ? yours.error : null,
              isPending: yours.isPending,
              refetch: () => {
                void yours.refetch();
              },
            }}
            loading={WORDS.loading}
            failed={(failure) => outcomeOfFailure(failure, "read").words}
            focusAfterRetry={headingRef}
          >
            <Questions yours={yours} />
          </ListRead>
        </Card>
      </section>
    </>
  );
}

function FeedbackGiven(properties: { readonly feedback: YourRecord["feedback"] }) {
  const headingId = useId();
  const { feedback } = properties;
  if (feedback.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="mt-8 grid gap-3">
      <h2 id={headingId}>{WORDS.feedback}</h2>
      <ul className="grid gap-3">
        {feedback.map((given) => (
          <li key={given.id} className="grid gap-2 border-t border-border pt-3 first:border-t-0">
            <p className="font-medium">
              {given.verdict === "flag" ? flaggedWords(given.reason) : WORDS.markedHelpful}
            </p>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
              <Row term={WORDS.terms.given}>{instantWords(given.givenAt)}</Row>
              {given.note === null ? null : <Row term={WORDS.terms.note}>{given.note}</Row>}
              {given.disputed?.sentence == null ? null : (
                <Row term={WORDS.terms.disputed}>
                  <blockquote className="border-l border-border bg-muted px-3 py-2">
                    {given.disputed.sentence}
                  </blockquote>
                </Row>
              )}
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RecordShown(properties: { readonly record: YourRecord }) {
  const { record } = properties;
  const question = questionOf(record);
  useBreadcrumbLastPart(question);
  const shown = shownAnswerOf(record);
  return (
    <>
      <h2 className="mt-6 max-w-measure wrap-anywhere">{question}</h2>
      <p className="mt-2 text-muted-foreground">{instantWords(record.askedAt)}</p>
      {shown === undefined ? (
        <p className="mt-6">
          <Pill>{verdictWords(null)}</Pill>
        </p>
      ) : (
        <AnswerView answer={shown} />
      )}
      <FeedbackGiven feedback={record.feedback} />
    </>
  );
}

function RecordWaiting(properties: {
  readonly read: ReturnType<typeof useYourRecord>;
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const { read } = properties;
  if (read.error === null) {
    return <ListState state={{ kind: "loading", words: WORDS.recordLoading }} />;
  }
  return (
    <ListState
      state={{
        kind: "failed",
        words: outcomeOfFailure(read.error, "read").words,
        onRetry: () => {
          void read.refetch();
        },
        focusAfterRetry: properties.headingRef,
      }}
    />
  );
}

function RecordRead(properties: { readonly recordId: string; readonly notFound: ReactElement }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const read = useYourRecord(properties.recordId);

  if (read.error !== null && namesNoRecord(read.error)) return properties.notFound;
  return (
    <>
      <PageHead heading={headingOf(YOUR_QUESTIONS)} headingRef={headingRef} />
      {read.data === undefined ? (
        <RecordWaiting read={read} headingRef={headingRef} />
      ) : (
        <RecordShown record={read.data} />
      )}
    </>
  );
}

export function YourRecordPage(properties: {
  readonly recordId: string | undefined;
  readonly notFound: ReactElement;
}) {
  const { recordId, notFound } = properties;
  if (recordId === undefined) return notFound;
  return <RecordRead key={recordId} recordId={recordId} notFound={notFound} />;
}
