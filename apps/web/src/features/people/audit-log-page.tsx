import { useId, useMemo, useRef, useState, type RefObject } from "react";

import { Address } from "@/shared/address.tsx";
import { ceilingLiftsIn, type ApiError } from "@/shared/api/trpc.ts";
import { FilterRow } from "@/shared/filter-row.tsx";
import { Icon } from "@/shared/icon.tsx";
import { useKeystroke, usePageKeystrokes } from "@/shared/keystrokes.tsx";
import { useLanding } from "@/shared/landing.ts";
import { ListPages, ListRead, ListState } from "@/shared/list-pages.tsx";
import { CONTROL_CENTRE, menuGroupIn } from "@/shared/navigation.ts";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { ListHead, PageHead } from "@/shared/page-head.tsx";
import { refusedWith } from "@/shared/refusal-outcome.tsx";
import { useSearchedList } from "@/shared/searched-list.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Card } from "@/shared/ui/card.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/ui/collapsible.tsx";
import { byWords, instantWords } from "@/shared/words.ts";

import { detailLinesOf, type DetailLine } from "./audit-details.ts";
import {
  useAuditLog,
  useExportAuditLog,
  type Asked,
  type AuditLog,
  type ReadAuditEvent,
} from "./audit-log-api.ts";
import {
  AUDIT_LOG_FIELDS,
  AUDIT_LOG_KEYSTROKES as KEY,
  AUDIT_LOG_LIST,
  FAMILIES,
  SEARCH_MAX,
} from "./audit-log-state.ts";
import { AUDIT_LOG_WORDS as WORDS } from "./audit-log-words.ts";
import { headlineOf, sentenceOf } from "./audit-sentences.ts";
import { personSaid } from "./audit-subjects.ts";
import { EventDays } from "./event-days.tsx";
import { auditExportCeiling } from "./refusal-words.ts";
import { outcomeOfAuditLogFailure } from "./refusal.tsx";

const system = menuGroupIn(CONTROL_CENTRE, "system");

const LISTED = Object.values(KEY);

const eventsOf = (data: AuditLog["data"]): readonly ReadAuditEvent[] =>
  data?.pages.flatMap((page) => page.events) ?? [];

/** A sign-in address stands beneath its person's name, so two of one name are told apart. */
function DetailRow(properties: { readonly line: DetailLine }) {
  const { label, value, address } = properties.line;
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 wrap-anywhere">
        {value}
        {address === undefined ? null : (
          <Address address={address} className="block text-muted-foreground" />
        )}
      </dd>
    </>
  );
}

const byLine = (by: ReadAuditEvent["by"]): DetailLine => {
  const line = { key: "by", label: WORDS.by };
  return by.kind === "person"
    ? { ...line, ...personSaid(by.displayName, by.address) }
    : { ...line, value: byWords(by) };
};

const subjectLines = (subject: ReadAuditEvent["subject"]): readonly DetailLine[] =>
  subject?.kind === "person" && subject.displayName !== ""
    ? [{ key: "subject", label: WORDS.about, ...personSaid(subject.displayName, subject.address) }]
    : [];

/** Drawn only once the details open. */
function DetailList(properties: { readonly event: ReadAuditEvent }) {
  const { event } = properties;
  const lines = [byLine(event.by), ...subjectLines(event.subject), ...detailLinesOf(event)];
  return (
    <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
      {lines.map((line) => (
        <DetailRow key={line.key} line={line} />
      ))}
    </dl>
  );
}

/** The display names two actors among these events share, so each one's line says which. */
const namesShared = (events: readonly ReadAuditEvent[]): ReadonlySet<string> => {
  const addressesOf = new Map<string, Set<string>>();
  for (const { by } of events) {
    if (by.kind !== "person") continue;
    addressesOf.set(by.displayName, (addressesOf.get(by.displayName) ?? new Set()).add(by.address));
  }
  return new Set([...addressesOf].filter(([, held]) => held.size > 1).map(([name]) => name));
};

/** An actor named by their address alone has none to add. */
const addressAtRest = (
  by: ReadAuditEvent["by"],
  shared: ReadonlySet<string>,
): string | undefined =>
  by.kind === "person" && shared.has(by.displayName)
    ? personSaid(by.displayName, by.address).address
    : undefined;

/** One line at rest: the sentence, then Details, whose list opens on a line of its own beneath. */
function EventLine(properties: {
  readonly event: ReadAuditEvent;
  readonly address: string | undefined;
}) {
  const { event, address } = properties;
  return (
    <Collapsible className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3">
      <span className="min-w-0 flex-1 wrap-anywhere">
        {sentenceOf(event)}
        {address === undefined ? null : (
          <>
            {" "}
            <Address address={address} className="text-xs text-muted-foreground" />
          </>
        )}
      </span>
      <CollapsibleTrigger asChild>
        <Button
          variant="link"
          size="sm"
          className="group -mx-1 h-auto min-h-6 gap-1 px-1 has-[>svg]:px-1"
        >
          {WORDS.details}
          <span className="sr-only">
            {WORDS.detailsOf(headlineOf(event.action), instantWords(event.at))}
          </span>
          <Icon
            name="caret-down"
            className="transition-transform group-data-[state=open]:rotate-180"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="basis-full">
        <DetailList event={event} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function NoneShown(properties: {
  readonly asked: Asked;
  readonly onClear: () => void;
  readonly focusAfterClear: RefObject<HTMLInputElement | null>;
}) {
  const { asked } = properties;
  if (asked.family === undefined && asked.search === "") {
    return <ListState state={{ kind: "empty", words: WORDS.none, action: undefined }} />;
  }
  return (
    <ListState
      state={{
        kind: "emptied",
        words: WORDS.noneNarrowed(asked),
        onClear: properties.onClear,
        focusAfterClear: properties.focusAfterClear,
      }}
    />
  );
}

function Events(properties: {
  readonly auditLog: AuditLog;
  readonly events: readonly ReadAuditEvent[];
  readonly asked: Asked;
  readonly onClear: () => void;
  readonly searchRef: RefObject<HTMLInputElement | null>;
}) {
  const { auditLog, events } = properties;
  const landing = useLanding();
  const shared = useMemo(() => namesShared(events), [events]);

  if (events.length === 0) {
    return (
      <NoneShown
        asked={properties.asked}
        onClear={properties.onClear}
        focusAfterClear={properties.searchRef}
      />
    );
  }

  const showOlder = () => {
    landing.landOn(events.length);
    void auditLog.fetchNextPage();
  };

  return (
    <>
      <EventDays
        events={events}
        landing={landing}
        line={(event) => <EventLine event={event} address={addressAtRest(event.by, shared)} />}
      />
      <ListPages
        pages={{
          kind: "more",
          label: WORDS.older,
          more: auditLog.hasNextPage,
          loading: auditLog.isFetchingNextPage,
          onMore: showOlder,
          keystroke: KEY.older,
        }}
      />
    </>
  );
}

/** The reader's own day, which `en-CA` writes year first. */
const fileName = (): string => `audit-log-${new Date().toLocaleDateString("en-CA")}.csv`;

/** The text is already in the browser, so a link to it saves the file without asking again. */
const save = (csv: string, name: string): void => {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
};

const exportFailed = (failure: Error | ApiError): Outcome => {
  const liftsInSeconds = ceilingLiftsIn(failure);
  return liftsInSeconds === undefined
    ? outcomeOfAuditLogFailure(failure, "action")
    : refusedWith(auditExportCeiling(liftsInSeconds));
};

function ExportAction(properties: {
  readonly asked: Asked;
  readonly nothingMatches: boolean;
  readonly say: (outcome: Outcome) => void;
}) {
  const { asked, nothingMatches, say } = properties;
  const exporting = useExportAuditLog();
  const run = () => {
    if (nothingMatches || exporting.isPending) return;
    exporting.exportFor(asked).then(
      (exported) => {
        const name = fileName();
        save(exported.csv, name);
        say({ tone: "said", words: WORDS.saved(exported, name) });
      },
      (failure: Error | ApiError) => {
        say(exportFailed(failure));
      },
    );
  };
  useKeystroke(KEY.export, run);

  return (
    <Button
      variant="outline"
      aria-disabled={nothingMatches || exporting.isPending}
      aria-keyshortcuts={KEY.export.key}
      className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      onClick={run}
    >
      <Icon name="exports" />
      {exporting.isPending ? WORDS.exporting : WORDS.export}
    </Button>
  );
}

function AuditLogRegion() {
  const headingId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const { state, write, search, setSearch, clear } = useSearchedList(
    AUDIT_LOG_LIST,
    AUDIT_LOG_FIELDS,
  );
  const asked: Asked = { family: state.family, search: state.search };
  const auditLog = useAuditLog(asked);
  const [outcome, setOutcome] = useState<Outcome>();
  const events = useMemo(() => eventsOf(auditLog.data), [auditLog.data]);
  const tooBroad = auditLog.data?.pages[0]?.searchTooBroad === true;

  return (
    <section aria-labelledby={headingId} className="mt-6">
      <ListHead
        heading={WORDS.heading}
        headingId={headingId}
        description={WORDS.summary}
        count={
          auditLog.data === undefined
            ? ""
            : WORDS.counted(asked, events.length, auditLog.hasNextPage)
        }
        action={
          <ExportAction
            asked={asked}
            nothingMatches={auditLog.data !== undefined && events.length === 0}
            say={setOutcome}
          />
        }
      />
      <OutcomeLine outcome={outcome} className="mt-2" />

      <Card className="mt-4">
        <FilterRow
          search={{
            label: WORDS.search,
            maxLength: SEARCH_MAX,
            value: search,
            onChange: setSearch,
            keystroke: KEY.search,
            inputRef: searchRef,
          }}
          filters={[
            {
              label: WORDS.family,
              value: asked.family,
              anyLabel: WORDS.everyFamily,
              choices: FAMILIES.map((family) => ({ value: family, label: WORDS.families[family] })),
              onChange: (picked) => {
                write({ family: FAMILIES.find((family) => family === picked) });
              },
            },
          ]}
        />
        <p className="border-b border-border px-3 py-2 text-muted-foreground empty:hidden">
          {tooBroad ? WORDS.tooBroad : ""}
        </p>
        <ListRead
          read={auditLog}
          loading={WORDS.loading}
          failed={(failure) => outcomeOfAuditLogFailure(failure, "read").words}
          focusAfterRetry={searchRef}
        >
          {/* Keyed, so a page of older events never lands its focus in another search's list. */}
          <Events
            key={`${asked.family ?? ""}:${asked.search}`}
            auditLog={auditLog}
            events={events}
            asked={asked}
            onClear={clear}
            searchRef={searchRef}
          />
        </ListRead>
      </Card>
    </section>
  );
}

export function AuditLogPage() {
  usePageKeystrokes(LISTED);

  return (
    <>
      <PageHead heading={system.name} summary={system.summary} />
      <AuditLogRegion />
    </>
  );
}
