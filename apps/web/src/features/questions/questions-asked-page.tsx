import { useId, useMemo, useRef, useState } from "react";

import { questionWords } from "@/shared/answer-words.ts";
import { usePageKeystrokes, useKeystroke } from "@/shared/keystrokes.tsx";
import { useLanding, useLandingLine, type Landing } from "@/shared/landing.ts";
import { useLastRead } from "@/shared/last-read.ts";
import { cn } from "@/shared/lib/utils.ts";
import { ListPages, ListRead, ListState } from "@/shared/list-pages.tsx";
import { CONTROL_CENTRE, menuGroupIn } from "@/shared/navigation.ts";
import { OutcomeLine, selectFirst, type Outcome } from "@/shared/outcome.tsx";
import { ListHead, PageHead } from "@/shared/page-head.tsx";
import { refusalsOf } from "@/shared/refusal-outcome.tsx";
import { keyedRow, rowInFocus } from "@/shared/row-focus.ts";
import { RowSheetButton } from "@/shared/row-sheet.tsx";
import { Card } from "@/shared/ui/card.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
import { instantWords } from "@/shared/words.ts";

import { QuestionSheet, askerWords, recordButtonId, useFlagClosing } from "./question-sheet.tsx";
import {
  isOpen,
  useQuestionsAsked,
  type AskedRecord,
  type QuestionsAsked,
} from "./questions-api.ts";
import { groupedForReading, latestOfEach } from "./questions-grouping.ts";
import { QUESTIONS_KEYSTROKES as KEY } from "./questions-state.ts";
import { QUESTIONS_WORDS as WORDS } from "./questions-words.ts";

const questions = menuGroupIn(CONTROL_CENTRE, "questions");

const LISTED = Object.values(KEY);

const { outcomeOfFailure } = refusalsOf({});

const NOTHING_IN_FOCUS = selectFirst(WORDS.selectFirst);

const recordsOf = (data: QuestionsAsked["data"]): readonly AskedRecord[] =>
  latestOfEach(data?.pages.flatMap((page) => page.records) ?? []);

type RowActions = {
  readonly open: (recordId: string) => void;
  readonly servedAt: ReadonlyMap<string, number>;
  readonly landing: Landing;
};

function RecordItem(properties: { readonly record: AskedRecord; readonly actions: RowActions }) {
  const { record, actions } = properties;
  const land = useLandingLine(
    actions.servedAt.get(record.id) === actions.landing.landAt,
    actions.landing.landed,
  );
  const openFlags = record.feedback.filter(isOpen);
  return (
    <li
      className="grid justify-items-start gap-1 border-t border-border px-3 py-3 first:border-t-0"
      {...keyedRow(record.id)}
    >
      <RowSheetButton
        ref={land}
        id={recordButtonId(record.id)}
        className={cn("has-[>svg]:px-0", record.question === null && "text-muted-foreground")}
        onClick={() => {
          actions.open(record.id);
        }}
      >
        {questionWords(record)}
      </RowSheetButton>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
        <Pill>{WORDS.verdict(record.verdict)}</Pill>
        {openFlags.map((flag) => (
          <Pill key={flag.id}>{WORDS.flaggedAs(flag.reason)}</Pill>
        ))}
        <span>
          {askerWords(record.askedBy)} · {WORDS.where[record.transport]} ·{" "}
          {instantWords(record.askedAt)}
        </span>
      </div>
    </li>
  );
}

function RecordGroup(properties: {
  readonly title: string;
  readonly records: readonly AskedRecord[];
  readonly actions: RowActions;
}) {
  const headingId = useId();
  const { records, actions } = properties;
  if (records.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="border-t border-border first:border-t-0">
      <h3
        id={headingId}
        className="max-w-none border-b border-border bg-muted px-3 py-2 font-medium"
      >
        {properties.title}
      </h3>
      <ul>
        {records.map((record) => (
          <RecordItem key={record.id} record={record} actions={actions} />
        ))}
      </ul>
    </section>
  );
}

function Records(properties: { readonly asked: QuestionsAsked }) {
  const { asked } = properties;
  const records = useMemo(() => recordsOf(asked.data), [asked.data]);
  const grouped = useMemo(() => groupedForReading(records), [records]);
  const servedAt = useMemo(() => new Map(records.map((record, at) => [record.id, at])), [records]);
  const landing = useLanding();
  const [openedId, setOpenedId] = useState<string>();
  const [outcome, setOutcome] = useState<Outcome>();
  const opened = useLastRead(records, openedId);
  const closing = useFlagClosing();

  useKeystroke(KEY.open, () => {
    const record = rowInFocus(records, (each) => each.id);
    setOutcome(record === undefined ? NOTHING_IN_FOCUS : undefined);
    if (record !== undefined) setOpenedId(record.id);
  });

  if (records.length === 0) {
    return <ListState state={{ kind: "empty", words: WORDS.none, action: undefined }} />;
  }

  const actions: RowActions = {
    open: (recordId) => {
      setOutcome(undefined);
      setOpenedId(recordId);
    },
    servedAt,
    landing,
  };

  return (
    <>
      <OutcomeLine outcome={outcome} className="px-3 empty:hidden" />
      <RecordGroup title={WORDS.flagged} records={grouped.flagged} actions={actions} />
      <RecordGroup title={WORDS.others} records={grouped.others} actions={actions} />
      <RecordGroup title={WORDS.notAnswered} records={grouped.notAnswered} actions={actions} />
      <ListPages
        pages={{
          kind: "more",
          label: WORDS.more,
          more: asked.hasNextPage,
          loading: asked.isFetchingNextPage,
          onMore: () => {
            landing.landOn(records.length);
            void asked.fetchNextPage();
          },
          keystroke: KEY.more,
        }}
      />
      {opened === undefined ? null : (
        <QuestionSheet
          key={opened.id}
          record={opened}
          closing={closing}
          onClose={() => {
            setOpenedId(undefined);
          }}
        />
      )}
    </>
  );
}

function QuestionsAskedRegion() {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const asked = useQuestionsAsked();

  return (
    <section aria-labelledby={headingId} className="mt-6">
      <ListHead heading={WORDS.heading} headingId={headingId} headingRef={headingRef} count="" />
      <Card className="mt-4 gap-0 py-0">
        <ListRead
          read={asked}
          loading={WORDS.loading}
          failed={(failure) => outcomeOfFailure(failure, "read").words}
          focusAfterRetry={headingRef}
        >
          <Records asked={asked} />
        </ListRead>
      </Card>
    </section>
  );
}

export function QuestionsAskedPage() {
  usePageKeystrokes(LISTED);

  return (
    <>
      <PageHead heading={questions.name} summary={questions.summary} />
      <QuestionsAskedRegion />
    </>
  );
}
