import { createContext, useCallback, useContext, useId, useState, type Ref } from "react";

import { refusalOf, type ApiError } from "@/shared/api/trpc.ts";
import { Icon } from "@/shared/icon.tsx";
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
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table.tsx";
import type { ViewToolbar } from "@/shared/view-toolbar.tsx";
import { counted, instantWords, timeWords, weekdayWords } from "@/shared/words.ts";

import {
  useAuditLog,
  type AuditEventActor,
  type AuditLog,
  type Family,
  type ReadAuditEvent,
} from "./audit-log-api.ts";
import { AUDIT_LOG_KEYSTROKES } from "./audit-log-state.ts";

const people = screenById("people");

const AUDIT_LOG = "Audit log";

const SUMMARY =
  "Every act in this workspace except answers, newest first: what was done, to what, by whom and when. Answers are kept apart, in the answer audit on Questions.";

const CAPTION =
  "The audit log, newest first under each day: when each act happened, its family, what it was and who did it.";

const COLUMNS = ["When", "Family", "Act", "By"] as const;

const FAMILY_WORDS = {
  people: "People",
  knowledge: "Knowledge",
  sources: "Sources",
  platform: "Platform",
} as const satisfies Readonly<Record<Family, string>>;

const EVERY_FAMILY = "all";

type Picked = Family | typeof EVERY_FAMILY;

const isFamily = (value: string): value is Family => Object.hasOwn(FAMILY_WORDS, value);

/** The glossary's words for an actor the audit log cannot name by the name they gave. */
const BY_WORDS = {
  "former-member": "a former member",
  platform: "the platform",
} as const satisfies Readonly<Record<Exclude<AuditEventActor["kind"], "person">, string>>;

const byWords = (by: AuditEventActor): string =>
  by.kind === "person" ? by.displayName : BY_WORDS[by.kind];

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

const sentenceCase = (words: string): string => `${words.charAt(0).toUpperCase()}${words.slice(1)}`;

/** `people.member.role_changed` reads "Member role changed": the act's subject, then its verb. */
const wordsOfAct = (act: string): string => {
  const [, subject = "", verb = ""] = act.split(".");
  return sentenceCase(`${subject} ${verb}`.replaceAll("_", " "));
};

/** `adminUserId` reads "Admin person id": a screen names a person, never a user. */
const wordsOfField = (field: string): string =>
  sentenceCase(
    field
      .replaceAll(/([A-Z])/g, " $1")
      .toLowerCase()
      .replaceAll("user", "person"),
  );

const wordsOfValue = (value: string | number | boolean): string => {
  if (typeof value !== "boolean") return String(value);
  return value ? "yes" : "no";
};

const inTheFamily = (picked: Picked): string =>
  picked === EVERY_FAMILY ? "" : ` in the ${FAMILY_WORDS[picked].toLowerCase()} family`;

const saidOfTheAuditLog = (picked: Picked, shown: number, older: boolean): string => {
  if (shown === 0) return `No acts${inTheFamily(picked) || " in this workspace"} yet.`;
  if (older) return `The newest ${shown} events${inTheFamily(picked)}; older ones follow.`;
  return `${counted(shown, "event", "events")}${inTheFamily(picked)}.`;
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
        <Button ref={takeFocus} variant="link" size="sm" className="group h-auto gap-1 px-0">
          Details
          <span className="sr-only">{` of ${wordsOfAct(event.act)}, ${instantWords(event.at)}`}</span>
          <Icon
            name="caret-down"
            className="transition-transform group-data-[state=open]:rotate-180"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Recorded as</dt>
          <dd className="font-mono wrap-anywhere">{event.act}</dd>
          <dt className="text-muted-foreground">Subject</dt>
          <dd className="font-mono wrap-anywhere">{`${event.subjectKind} ${event.subjectId}`}</dd>
          <dt className="text-muted-foreground">Actor id</dt>
          <dd className="font-mono wrap-anywhere">{event.actor}</dd>
          {Object.entries(event.detail).map(([field, value]) => (
            <div key={field} className="contents">
              <dt className="text-muted-foreground">{wordsOfField(field)}</dt>
              <dd className="font-mono wrap-anywhere">{wordsOfValue(value)}</dd>
            </div>
          ))}
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
}

type Day = {
  readonly day: string;
  readonly events: readonly { readonly event: ReadAuditEvent; readonly index: number }[];
};

/** Newest first, so each day's events already stand together. */
const byDay = (events: readonly ReadAuditEvent[]): readonly Day[] => {
  const days = new Map<string, { event: ReadAuditEvent; index: number }[]>();
  for (const [index, event] of events.entries()) {
    const day = weekdayWords(event.at);
    days.set(day, [...(days.get(day) ?? []), { event, index }]);
  }
  return [...days].map(([day, held]) => ({ day, events: held }));
};

function DayOfEvents(properties: Day) {
  return (
    <TableBody>
      <TableRow className="border-border bg-muted hover:bg-muted">
        <TableHead scope="rowgroup" colSpan={COLUMNS.length} className="text-foreground">
          {properties.day}
        </TableHead>
      </TableRow>
      {properties.events.map(({ event, index }) => (
        <TableRow key={event.id} className="border-border">
          <TableCell>
            <time dateTime={event.at} className="tabular-nums">
              {timeWords(event.at)}
            </time>
          </TableCell>
          <TableCell>
            <Pill>{FAMILY_WORDS[event.family]}</Pill>
          </TableCell>
          <TableCell className="whitespace-normal">
            <EventDetails event={event} index={index} />
          </TableCell>
          <TableCell className="whitespace-normal">{byWords(event.by)}</TableCell>
        </TableRow>
      ))}
    </TableBody>
  );
}

function NothingInTheFamily(properties: {
  readonly picked: Picked;
  readonly onShowAll: () => void;
}) {
  return (
    <TableBody>
      <TableRow className="border-border hover:bg-transparent">
        <TableCell colSpan={COLUMNS.length} className="p-0 whitespace-normal">
          <div className="flex flex-col items-start gap-1 px-4 py-10">
            <p className="font-medium">{saidOfTheAuditLog(properties.picked, 0, false)}</p>
            <p className="text-muted-foreground">Each act is recorded here as it happens.</p>
            {properties.picked === EVERY_FAMILY ? null : (
              <Button variant="outline" className="mt-3" onClick={properties.onShowAll}>
                Show all families
              </Button>
            )}
          </div>
        </TableCell>
      </TableRow>
    </TableBody>
  );
}

function EventTable(properties: {
  readonly events: readonly ReadAuditEvent[];
  readonly picked: Picked;
  readonly onShowAll: () => void;
}) {
  return (
    <Table>
      <TableCaption className="sr-only">{CAPTION}</TableCaption>
      <TableHeader>
        <TableRow className="border-border hover:bg-transparent">
          {COLUMNS.map((column) => (
            <TableHead key={column} scope="col">
              {column}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      {properties.events.length === 0 ? (
        <NothingInTheFamily picked={properties.picked} onShowAll={properties.onShowAll} />
      ) : (
        byDay(properties.events).map((day) => <DayOfEvents key={day.day} {...day} />)
      )}
    </Table>
  );
}

function FamilyFilter(properties: {
  readonly id: string;
  readonly picked: Picked;
  readonly onPick: (picked: Picked) => void;
  readonly ref: Ref<HTMLButtonElement>;
}) {
  const { id, picked, onPick, ref } = properties;
  const [open, setOpen] = useState(false);
  useKeystroke(AUDIT_LOG_KEYSTROKES.family, () => {
    setOpen(true);
  });

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
      <Label htmlFor={id}>Family</Label>
      <Select
        value={picked}
        open={open}
        onOpenChange={setOpen}
        onValueChange={(value) => {
          onPick(isFamily(value) ? value : EVERY_FAMILY);
        }}
      >
        <SelectTrigger
          id={id}
          ref={ref}
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

/** A failure with no refusal word is the network's, so the filter stays for a pick to ask again. */
const refusedOutright = (auditLog: AuditLog): boolean =>
  auditLog.data === undefined && auditLog.error !== null && refusalOf(auditLog.error) !== undefined;

const eventsOf = (auditLog: AuditLog): readonly ReadAuditEvent[] =>
  auditLog.data?.pages.flatMap((page) => page.events) ?? [];

const saidOfTheRead = (auditLog: AuditLog, picked: Picked): string | undefined => {
  if (auditLog.isPending) return "The audit log is still loading.";
  if (auditLog.data === undefined) return undefined;
  return saidOfTheAuditLog(picked, eventsOf(auditLog).length, auditLog.hasNextPage);
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
  readonly auditLog: AuditLog;
  readonly picked: Picked;
  readonly onShowAll: () => void;
}) {
  const { auditLog } = properties;
  const [landAt, setLandAt] = useState<number>();
  const landed = useCallback(() => {
    setLandAt(undefined);
  }, []);
  const events = eventsOf(auditLog);

  const showOlder = () => {
    if (!auditLog.hasNextPage || auditLog.isFetchingNextPage) return;
    setLandAt(events.length);
    void auditLog.fetchNextPage();
  };
  useKeystroke(AUDIT_LOG_KEYSTROKES.older, showOlder);

  if (auditLog.data === undefined) return null;
  return (
    <>
      <LandingFocus value={{ at: landAt, landed }}>
        <EventTable events={events} picked={properties.picked} onShowAll={properties.onShowAll} />
      </LandingFocus>
      {auditLog.hasNextPage ? (
        <OlderEvents fetching={auditLog.isFetchingNextPage} onShow={showOlder} />
      ) : null}
    </>
  );
}

function AuditLogRegion() {
  const headingId = useId();
  const filterId = useId();
  const [picked, setPicked] = useState<Picked>(EVERY_FAMILY);
  const [filter, setFilter] = useState<HTMLButtonElement | null>(null);
  const auditLog = useAuditLog(picked === EVERY_FAMILY ? undefined : picked);

  const showAll = () => {
    filter?.focus();
    setPicked(EVERY_FAMILY);
  };

  return (
    <section aria-labelledby={headingId} className="mt-6">
      <h2 id={headingId}>{AUDIT_LOG}</h2>
      <p className="mt-1 max-w-prose text-muted-foreground">{SUMMARY}</p>
      <OutcomeLine
        outcome={auditLog.error === null ? undefined : outcomeOfFailure(auditLog.error)}
        className="mt-2"
      />
      <output className="mt-1 block text-muted-foreground">
        {saidOfTheRead(auditLog, picked)}
      </output>

      {refusedOutright(auditLog) ? null : (
        <div className="mt-4 border border-border bg-card">
          <FamilyFilter id={filterId} picked={picked} onPick={setPicked} ref={setFilter} />
          {/* Keyed, so a page of older events never lands its focus in another family's list. */}
          <EventPages key={picked} auditLog={auditLog} picked={picked} onShowAll={showAll} />
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
