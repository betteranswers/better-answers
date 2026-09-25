import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { createContext, useCallback, useContext, useId, useState } from "react";

import type { ApiError } from "@/shared/api/trpc.ts";
import { KeystrokesAct, useKeystroke } from "@/shared/keystrokes.tsx";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { failureOutcome, type SaidOfWord } from "@/shared/refusal-outcome.tsx";
import { screenById } from "@/shared/screens.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/ui/collapsible.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
import { Label } from "@/shared/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select.tsx";
import type { ViewToolbar } from "@/shared/view-toolbar.tsx";

import { useAuditLog, type AuditLog, type Family, type ReadAuditEvent } from "./audit-log-api.ts";
import { AUDIT_LOG_KEYSTROKES } from "./audit-log-state.ts";
import { GridTable } from "./grid-table.tsx";

const people = screenById("people");

const AUDIT_LOG = "Audit log";

const SUMMARY =
  "Every act in this workspace except answers, newest first: what was done, to what, by whom and when. Answers are kept apart, in the answer audit on Questions.";

const FAMILY_WORDS = {
  people: "People",
  knowledge: "Knowledge",
  sources: "Sources",
  platform: "Platform",
} as const satisfies Readonly<Record<Family, string>>;

const EVERY_FAMILY = "all";

type Picked = Family | typeof EVERY_FAMILY;

const isFamily = (value: string): value is Family => Object.hasOwn(FAMILY_WORDS, value);

const SAID_OF_WORD = {
  "role-forbids": {
    why: "Only an Admin of this workspace reads its audit log.",
    next: "Ask one of its Admins for what you need.",
  },
} satisfies SaidOfWord;

const outcomeOfFailure = (failure: Error | ApiError): Outcome =>
  failureOutcome(SAID_OF_WORD, failure);

export const AUDIT_LOG_TOOLBAR: ViewToolbar = {
  acts: <KeystrokesAct screen={people.name} keystrokes={Object.values(AUDIT_LOG_KEYSTROKES)} />,
};

const TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Europe/London",
});

const LONG_UK_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/London",
});

const saidWhen = (at: string): string => {
  const instant = new Date(at);
  return `${TIME.format(instant)} · ${LONG_UK_DATE.format(instant)}`;
};

/** `people.member.role_changed` reads "Member role changed": the act's subject, then its verb. */
const wordsOfAct = (act: string): string => {
  const [, subject = "", verb = ""] = act.split(".");
  const said = `${subject} ${verb}`.replaceAll("_", " ");
  return `${said.charAt(0).toUpperCase()}${said.slice(1)}`;
};

const countOfEvents = (count: number): string => (count === 1 ? "1 event" : `${count} events`);

const inTheFamily = (picked: Picked): string =>
  picked === EVERY_FAMILY ? "" : ` in the ${picked} family`;

const saidOfTheLog = (picked: Picked, shown: number, older: boolean): string => {
  if (shown === 0) return `No acts${inTheFamily(picked) || " in this workspace"} yet.`;
  if (older) return `The newest ${shown} events${inTheFamily(picked)}; older ones follow.`;
  return `${countOfEvents(shown)}${inTheFamily(picked)}.`;
};

/** The first event a page of older ones brought takes focus as it mounts, where reading resumes. */
const LandingFocus = createContext<{
  readonly at: number | undefined;
  readonly landed: () => void;
}>({ at: undefined, landed: () => {} });

function EventDetails(properties: { readonly event: ReadAuditEvent; readonly index: number }) {
  const { event, index } = properties;
  const landing = useContext(LandingFocus);
  const landsHere = landing.at === index;
  const { landed } = landing;
  const takeFocus = useCallback(
    (node: HTMLButtonElement | null) => {
      if (node === null || !landsHere) return;
      node.focus();
      landed();
    },
    [landsHere, landed],
  );

  return (
    <Collapsible>
      <span className="block">{wordsOfAct(event.act)}</span>
      <CollapsibleTrigger asChild>
        <Button ref={takeFocus} variant="link" size="sm" className="h-auto px-0">
          Details
          <span className="sr-only">{` of ${wordsOfAct(event.act)}, ${saidWhen(event.at)}`}</span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Recorded as</dt>
          <dd className="font-mono wrap-anywhere">{event.act}</dd>
          <dt className="text-muted-foreground">Subject</dt>
          <dd className="font-mono wrap-anywhere">{`${event.subjectKind} ${event.subjectId}`}</dd>
          {Object.entries(event.detail).map(([field, value]) => (
            <div key={field} className="contents">
              <dt className="font-mono text-muted-foreground">{field}</dt>
              <dd className="font-mono wrap-anywhere">{String(value)}</dd>
            </div>
          ))}
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
}

const features = tableFeatures({});

const column = createColumnHelper<typeof features, ReadAuditEvent>();

const COLUMNS = column.columns([
  column.accessor("at", {
    header: "When",
    cell: ({ getValue }) => (
      <time dateTime={getValue()} className="tabular-nums">
        {saidWhen(getValue())}
      </time>
    ),
  }),
  column.accessor("family", {
    header: "Family",
    cell: ({ getValue }) => <Pill>{FAMILY_WORDS[getValue()]}</Pill>,
  }),
  column.accessor("act", {
    header: "Act",
    cell: ({ row }) => <EventDetails event={row.original} index={row.index} />,
  }),
  column.accessor("by", { header: "By" }),
]);

function NothingInTheFamily(properties: {
  readonly picked: Picked;
  readonly onShowAll: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-1 px-4 py-10">
      <p className="font-medium">{saidOfTheLog(properties.picked, 0, false)}</p>
      <p className="text-muted-foreground">Each act is recorded here as it happens.</p>
      {properties.picked === EVERY_FAMILY ? null : (
        <Button variant="outline" className="mt-3" onClick={properties.onShowAll}>
          Show all families
        </Button>
      )}
    </div>
  );
}

function EventTable(properties: {
  readonly events: readonly ReadAuditEvent[];
  readonly picked: Picked;
  readonly onShowAll: () => void;
}) {
  const table = useTable({
    features,
    columns: COLUMNS,
    data: properties.events,
    getRowId: (event) => event.id,
  });

  return (
    <GridTable
      table={table}
      caption="The audit log, newest first: when each act happened, its family, what it was and who did it."
      empty={<NothingInTheFamily picked={properties.picked} onShowAll={properties.onShowAll} />}
    />
  );
}

function FamilyFilter(properties: {
  readonly id: string;
  readonly picked: Picked;
  readonly onPick: (picked: Picked) => void;
}) {
  const [open, setOpen] = useState(false);
  useKeystroke(AUDIT_LOG_KEYSTROKES.family, () => {
    setOpen(true);
  });

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
      <Label htmlFor={properties.id}>Family</Label>
      <Select
        value={properties.picked}
        open={open}
        onOpenChange={setOpen}
        onValueChange={(value) => {
          properties.onPick(isFamily(value) ? value : EVERY_FAMILY);
        }}
      >
        <SelectTrigger
          id={properties.id}
          aria-keyshortcuts={AUDIT_LOG_KEYSTROKES.family.key}
          className="w-48"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={EVERY_FAMILY}>All families</SelectItem>
          {Object.entries(FAMILY_WORDS).map(([family, words]) => (
            <SelectItem key={family} value={family}>
              {words}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const eventsOf = (log: AuditLog): readonly ReadAuditEvent[] =>
  log.data?.pages.flatMap((page) => page.events) ?? [];

const saidOfTheRead = (log: AuditLog, picked: Picked): string | undefined => {
  if (log.isPending) return "The audit log is still loading.";
  if (log.data === undefined) return undefined;
  return saidOfTheLog(picked, eventsOf(log).length, log.hasNextPage);
};

function OlderEvents(properties: { readonly fetching: boolean; readonly onShow: () => void }) {
  return (
    <div className="border-t border-border p-3">
      <Button
        variant="outline"
        aria-keyshortcuts={AUDIT_LOG_KEYSTROKES.older.key}
        aria-disabled={properties.fetching}
        onClick={properties.onShow}
      >
        {properties.fetching ? "Showing older events" : "Show older events"}
      </Button>
    </div>
  );
}

function EventPages(properties: {
  readonly log: AuditLog;
  readonly picked: Picked;
  readonly onShowAll: () => void;
}) {
  const { log } = properties;
  const [landAt, setLandAt] = useState<number>();
  const landed = useCallback(() => {
    setLandAt(undefined);
  }, []);
  const events = eventsOf(log);

  const showOlder = () => {
    if (!log.hasNextPage || log.isFetchingNextPage) return;
    setLandAt(events.length);
    void log.fetchNextPage();
  };
  useKeystroke(AUDIT_LOG_KEYSTROKES.older, showOlder);

  if (log.data === undefined) return null;
  return (
    <>
      <LandingFocus value={{ at: landAt, landed }}>
        <EventTable events={events} picked={properties.picked} onShowAll={properties.onShowAll} />
      </LandingFocus>
      {log.hasNextPage ? (
        <OlderEvents fetching={log.isFetchingNextPage} onShow={showOlder} />
      ) : null}
    </>
  );
}

function AuditLogRegion() {
  const headingId = useId();
  const filterId = useId();
  const [picked, setPicked] = useState<Picked>(EVERY_FAMILY);
  const log = useAuditLog(picked === EVERY_FAMILY ? undefined : picked);

  const showAll = () => {
    document.getElementById(filterId)?.focus();
    setPicked(EVERY_FAMILY);
  };

  return (
    <section aria-labelledby={headingId} className="mt-6">
      <h2 id={headingId}>{AUDIT_LOG}</h2>
      <p className="mt-1 max-w-prose text-muted-foreground">{SUMMARY}</p>
      <OutcomeLine
        outcome={log.error === null ? undefined : outcomeOfFailure(log.error)}
        className="mt-2"
      />
      <output className="mt-1 block text-muted-foreground">{saidOfTheRead(log, picked)}</output>

      {log.error !== null && log.data === undefined ? null : (
        <div className="mt-4 border border-border bg-card">
          <FamilyFilter id={filterId} picked={picked} onPick={setPicked} />
          {/* Keyed, so a page of older events never lands its focus in another family's list. */}
          <EventPages key={picked} log={log} picked={picked} onShowAll={showAll} />
        </div>
      )}
    </section>
  );
}

export function AuditLogView() {
  return (
    <>
      <h1>{people.name}</h1>
      <p className="mt-2 text-muted-foreground">{people.summary}</p>
      <AuditLogRegion />
    </>
  );
}
