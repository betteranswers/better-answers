import { useNavigate } from "@tanstack/react-router";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useMemo, useRef, useState, type RefObject } from "react";

import { GridTable } from "@/shared/grid-table.tsx";
import { useKeystroke } from "@/shared/keystrokes.tsx";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { RefusalLine } from "@/shared/refusal-outcome.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { counted } from "@/shared/words.ts";

import { Pages, turnsOf, type PageTurns } from "./everyone-pages.tsx";
import { SearchField, useAsking } from "./everyone-search.tsx";
import { arrival, EVERYONE_PATH, type Arrival } from "./people-address.ts";
import { usePeople, type Asked, type ListedPerson } from "./people-api.ts";
import { NO_PERSON_IN_FOCUS, PEOPLE_KEYSTROKES } from "./people-keystrokes.ts";
import { PersonSheet, personButtonId, type OpenedAt } from "./person-sheet.tsx";
import { Instant, Memberships } from "./person-words.tsx";
import { readRefused } from "./words.ts";

const features = tableFeatures({});

const column = createColumnHelper<typeof features, ListedPerson>();

const ON_THE_FIRST_PAGE: Outcome = { tone: "said", words: "This is the first page of people." };

const ON_THE_LAST_PAGE: Outcome = { tone: "said", words: "This is the last page of people." };

type PersonActs = {
  readonly open: (personId: string) => void;
  readonly focusedOn: (personId: string) => void;
};

function PersonCell(properties: { readonly person: ListedPerson; readonly acts: PersonActs }) {
  const { person, acts } = properties;
  const unnamed = person.displayName === "";
  return (
    <div className="grid justify-items-start gap-0.5">
      <Button
        id={personButtonId(person.id)}
        variant="link"
        aria-haspopup="dialog"
        className="h-auto p-0 text-left font-medium whitespace-normal text-foreground"
        onFocus={() => {
          acts.focusedOn(person.id);
        }}
        onClick={() => {
          acts.open(person.id);
        }}
      >
        {unnamed ? <span className="text-muted-foreground">No display name yet</span> : null}
        {unnamed ? null : person.displayName}
      </Button>
      <span className="text-xs wrap-anywhere text-muted-foreground">{person.email}</span>
    </div>
  );
}

/** The person's own cell opens them, so its acts ride into the columns. */
const columnsFor = (acts: PersonActs) =>
  column.columns([
    column.display({
      id: "person",
      header: "Person",
      cell: ({ row }) => <PersonCell person={row.original} acts={acts} />,
    }),
    column.display({
      id: "memberships",
      header: "Workspaces and roles",
      cell: ({ row }) => <Memberships person={row.original} />,
    }),
    column.accessor("lastSignedInAt", {
      header: "Last sign-in",
      cell: ({ getValue }) => <Instant at={getValue()} none="None on record" />,
    }),
  ]);

type Listed = ReturnType<typeof usePeople>;

const matching = (total: number, search: string): string =>
  total === 1 ? `1 person matches “${search}”.` : `${total} people match “${search}”.`;

const countSaid = (listed: Listed, asked: Asked): string => {
  if (listed.data === undefined) return "The people are still loading.";
  if (listed.isPlaceholderData) return "Reading the list again.";
  const { total } = listed.data;
  if (asked.search !== "") return matching(total, asked.search);
  return `${counted(total, "person", "people")} on the platform.`;
};

function ListSaid(properties: { readonly listed: Listed; readonly asked: Asked }) {
  const { listed } = properties;
  return (
    <output className="mt-1 block text-muted-foreground">
      {listed.error === null ? (
        countSaid(listed, properties.asked)
      ) : (
        <RefusalLine said={readRefused(listed.error)} />
      )}
    </output>
  );
}

function NoOneMatches(properties: { readonly search: string; readonly onClear: () => void }) {
  if (properties.search === "") {
    return <p className="px-4 py-10">No one is on the platform yet.</p>;
  }
  return (
    <div className="grid justify-items-start gap-1 px-4 py-10">
      <p className="font-medium">No one matches “{properties.search}”.</p>
      <p className="text-muted-foreground">Clear the search to see everyone.</p>
      <Button variant="outline" className="mt-3" onClick={properties.onClear}>
        Clear the search
      </Button>
    </div>
  );
}

type Opened = { readonly personId: string; readonly at: OpenedAt };

/** Signing in again comes back with the person named, to be reopened at the act. */
const reopened = (arrived: Arrival): Opened | undefined =>
  arrived.personId === undefined ? undefined : { personId: arrived.personId, at: arrived.act };

const NO_ONE: readonly ListedPerson[] = [];

/** Correcting a name can take its person out of the search; their sheet stays on the last read. */
const useLastRead = (
  people: readonly ListedPerson[],
  personId: string | undefined,
): ListedPerson | undefined => {
  const found = people.find((listed) => listed.id === personId);
  const [lastRead, setLastRead] = useState(found);
  if (found !== undefined && found !== lastRead) setLastRead(found);
  return found ?? (lastRead?.id === personId ? lastRead : undefined);
};

function OpenedSheet(properties: {
  readonly opened: Opened | undefined;
  readonly people: readonly ListedPerson[];
  readonly onClose: () => void;
  readonly returnFocus: (personId: string) => void;
}) {
  const { opened } = properties;
  const person = useLastRead(properties.people, opened?.personId);
  if (opened === undefined || person === undefined) return null;
  return (
    <PersonSheet
      key={person.id}
      person={person}
      openedAt={opened.at}
      onClose={properties.onClose}
      returnFocus={() => {
        properties.returnFocus(person.id);
      }}
    />
  );
}

/** A keystroke that cannot act says why through `say`, rather than doing nothing. */
function usePeopleKeystrokes(properties: {
  readonly searchRef: RefObject<HTMLInputElement | null>;
  readonly openInFocus: (at: OpenedAt) => void;
  readonly turns: PageTurns;
  readonly turnTo: (offset: number) => void;
  readonly say: (outcome: Outcome | undefined) => void;
}) {
  const { searchRef, openInFocus, turns, turnTo, say } = properties;
  const turnOr = (offset: number | undefined, otherwise: Outcome) => {
    say(offset === undefined ? otherwise : undefined);
    if (offset !== undefined) turnTo(offset);
  };

  useKeystroke(PEOPLE_KEYSTROKES.search, () => {
    searchRef.current?.focus();
  });
  useKeystroke(PEOPLE_KEYSTROKES.open, () => {
    openInFocus("person");
  });
  useKeystroke(PEOPLE_KEYSTROKES.revoke, () => {
    openInFocus("revoke");
  });
  useKeystroke(PEOPLE_KEYSTROKES.correct, () => {
    openInFocus("correct");
  });
  useKeystroke(PEOPLE_KEYSTROKES.previous, () => {
    turnOr(turns.previous, ON_THE_FIRST_PAGE);
  });
  useKeystroke(PEOPLE_KEYSTROKES.next, () => {
    turnOr(turns.next, ON_THE_LAST_PAGE);
  });
}

export function EveryoneList() {
  const [arrived] = useState(arrival);
  const { typed, asked, type, clear, turnTo } = useAsking(arrived.search);
  const [inFocus, setInFocus] = useState<string>();
  const [opened, setOpened] = useState(() => reopened(arrived));
  const [outcome, setOutcome] = useState<Outcome>();
  const searchRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const listed = usePeople(asked);
  // A refused read leaves nothing listed: what it held may no longer be the reader's to see.
  const page = listed.error === null ? listed.data : undefined;
  const people = page?.people ?? NO_ONE;
  const total = page?.total ?? 0;
  const turns = turnsOf(asked.offset, total);

  const columns = useMemo(
    () =>
      columnsFor({
        open: (personId) => {
          setOpened({ personId, at: "person" });
        },
        focusedOn: setInFocus,
      }),
    [],
  );
  const table = useTable({ features, columns, data: people, getRowId: (person) => person.id });

  /** A letter pressed outside the list still needs a person, so the one last in focus stands. */
  const openInFocus = (at: OpenedAt) => {
    const person = people.find((listedPerson) => listedPerson.id === inFocus);
    setOutcome(person === undefined ? NO_PERSON_IN_FOCUS : undefined);
    if (person !== undefined) setOpened({ personId: person.id, at });
  };
  usePeopleKeystrokes({ searchRef, openInFocus, turns, turnTo, say: setOutcome });

  const clearAndStay = () => {
    clear();
    searchRef.current?.focus();
  };
  // The address that reopened the person has served once they are closed; a reload starts afresh.
  const close = () => {
    setOpened(undefined);
    if (arrived.personId !== undefined) void navigate({ to: EVERYONE_PATH, replace: true });
  };

  return (
    <>
      <ListSaid listed={listed} asked={asked} />
      <OutcomeLine outcome={outcome} className="mt-2" />

      <div className="mt-4 border border-border bg-card">
        <SearchField searchRef={searchRef} typed={typed} type={type} clear={clear} />
        {page === undefined ? null : (
          <>
            <GridTable
              table={table}
              caption="Every person on the platform, with the workspaces they belong to, their role in each and their last sign-in. A person's name opens them."
              empty={<NoOneMatches search={asked.search} onClear={clearAndStay} />}
            />
            <Pages
              offset={asked.offset}
              shown={people.length}
              total={total}
              turns={turns}
              keystrokes={{
                previous: PEOPLE_KEYSTROKES.previous.key,
                next: PEOPLE_KEYSTROKES.next.key,
              }}
              turnTo={turnTo}
            />
          </>
        )}
      </div>

      <OpenedSheet
        opened={opened}
        people={people}
        onClose={close}
        returnFocus={(personId) => {
          // A person the list no longer holds has no row to go back to.
          (document.getElementById(personButtonId(personId)) ?? searchRef.current)?.focus();
        }}
      />
    </>
  );
}
