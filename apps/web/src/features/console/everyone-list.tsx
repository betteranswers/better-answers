import { useNavigate } from "@tanstack/react-router";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useId, useMemo, useRef, useState } from "react";

import { Address } from "@/shared/address.tsx";
import { FilterRow } from "@/shared/filter-row.tsx";
import { GridTable } from "@/shared/grid-table.tsx";
import { useKeystroke } from "@/shared/keystrokes.tsx";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { ListHead } from "@/shared/page-head.tsx";
import { RowSheetButton } from "@/shared/row-sheet.tsx";
import { Card } from "@/shared/ui/card.tsx";

import { Pages, turnsOf, type PageTurns } from "./everyone-pages.tsx";
import { useAsking } from "./everyone-search.tsx";
import { NothingListed, ReadSaid } from "./list-parts.tsx";
import { EVERYONE_WORDS as WORDS } from "./list-words.ts";
import { arrival, EVERYONE_PATH, type Arrival } from "./people-address.ts";
import { usePeople, type ListedPerson } from "./people-api.ts";
import { PEOPLE_KEYSTROKES } from "./people-keystrokes.ts";
import { PersonSheet, personButtonId, type OpenedAt } from "./person-sheet.tsx";
import { Instant, WorkspacesAndRoles } from "./person-words.tsx";
import { NO_PERSON_IN_FOCUS } from "./words.ts";

const features = tableFeatures({});

const column = createColumnHelper<typeof features, ListedPerson>();

const ON_THE_FIRST_PAGE: Outcome = { tone: "said", words: WORDS.onTheFirstPage };

const ON_THE_LAST_PAGE: Outcome = { tone: "said", words: WORDS.onTheLastPage };

type PersonActions = {
  readonly open: (personId: string) => void;
  readonly focusedOn: (personId: string) => void;
};

function PersonCell(properties: {
  readonly person: ListedPerson;
  readonly actions: PersonActions;
}) {
  const { person, actions } = properties;
  const unnamed = person.displayName === "";
  return (
    <div className="grid justify-items-start gap-0.5">
      <RowSheetButton
        id={personButtonId(person.id)}
        onFocus={() => {
          actions.focusedOn(person.id);
        }}
        onClick={() => {
          actions.open(person.id);
        }}
      >
        {unnamed ? <span className="text-muted-foreground">No display name yet</span> : null}
        {unnamed ? null : person.displayName}
      </RowSheetButton>
      <Address address={person.email} className="text-xs text-muted-foreground" />
    </div>
  );
}

/** The person's own cell opens them, so its actions ride into the columns. */
const columnsFor = (actions: PersonActions) =>
  column.columns([
    column.display({
      id: "person",
      header: "Person",
      cell: ({ row }) => <PersonCell person={row.original} actions={actions} />,
    }),
    column.display({
      id: "workspaces",
      header: "Workspaces and roles",
      cell: ({ row }) => <WorkspacesAndRoles person={row.original} />,
    }),
    column.accessor("lastSignedInAt", {
      header: "Last sign-in",
      cell: ({ getValue }) => <Instant at={getValue()} none="None on record" />,
    }),
  ]);

type Listed = ReturnType<typeof usePeople>;

const NO_ONE: readonly ListedPerson[] = [];

/** A refused read leaves nothing listed: what it held may no longer be the reader's to see. */
const readOf = (listed: Listed) => {
  const page = listed.error === null ? listed.data : undefined;
  return { page, people: page?.people ?? NO_ONE, total: page?.total ?? 0 };
};

/** The page showing stays while the next is read, so its count would be the last search's. */
const countSaid = (readingAgain: boolean, total: number, search: string): string => {
  if (readingAgain) return WORDS.readingAgain;
  return search === "" ? WORDS.counted(total) : WORDS.matching(total, search);
};

type Opened = { readonly personId: string; readonly at: OpenedAt };

/** Signing in again comes back with the person named, to be reopened at the action. */
const reopened = (arrived: Arrival): Opened | undefined =>
  arrived.personId === undefined ? undefined : { personId: arrived.personId, at: arrived.action };

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

/** A keystroke that cannot act says why through `say`; the search's own is the filter row's. */
function usePeopleKeystrokes(properties: {
  readonly openInFocus: (at: OpenedAt) => void;
  readonly turns: PageTurns;
  readonly turnTo: (offset: number) => void;
  readonly say: (outcome: Outcome | undefined) => void;
}) {
  const { openInFocus, turns, turnTo, say } = properties;
  const turnOr = (offset: number | undefined, otherwise: Outcome) => {
    say(offset === undefined ? otherwise : undefined);
    if (offset !== undefined) turnTo(offset);
  };

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
  const headingId = useId();
  const [arrived] = useState(arrival);
  const { typed, asked, type, clear, turnTo } = useAsking(arrived.search);
  const [inFocus, setInFocus] = useState<string>();
  const [opened, setOpened] = useState(() => reopened(arrived));
  const [outcome, setOutcome] = useState<Outcome>();
  const searchRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const listed = usePeople(asked);
  const { page, people, total } = readOf(listed);
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
  usePeopleKeystrokes({ openInFocus, turns, turnTo, say: setOutcome });

  // The address that reopened the person has served once they are closed; a reload starts afresh.
  const close = () => {
    setOpened(undefined);
    if (arrived.personId !== undefined) void navigate({ to: EVERYONE_PATH, replace: true });
  };

  return (
    <section aria-labelledby={headingId} className="mt-6">
      <ListHead
        heading={WORDS.heading}
        headingId={headingId}
        description={WORDS.description}
        count={page === undefined ? "" : countSaid(listed.isPlaceholderData, total, asked.search)}
      />
      <ReadSaid read={listed} loading={WORDS.loading} />
      <OutcomeLine outcome={outcome} className="mt-2" />

      <Card className="mt-4">
        <FilterRow
          search={{
            label: WORDS.search,
            value: typed,
            onChange: type,
            keystroke: PEOPLE_KEYSTROKES.search,
            inputRef: searchRef,
          }}
        />
        {page === undefined ? null : (
          <>
            <GridTable
              table={table}
              caption={WORDS.caption}
              empty={
                <NothingListed
                  search={asked.search}
                  noneMatch={WORDS.noneMatch}
                  onClear={clear}
                  searchRef={searchRef}
                >
                  <p className="px-4 py-10">{WORDS.noneYet}</p>
                </NothingListed>
              }
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
      </Card>

      <OpenedSheet
        opened={opened}
        people={people}
        onClose={close}
        returnFocus={(personId) => {
          // A person the list no longer holds has no row to go back to.
          (document.getElementById(personButtonId(personId)) ?? searchRef.current)?.focus();
        }}
      />
    </section>
  );
}
