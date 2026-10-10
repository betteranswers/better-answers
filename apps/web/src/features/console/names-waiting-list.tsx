import { Link, useNavigate } from "@tanstack/react-router";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useId, useMemo, useRef, useState } from "react";

import { FilterRow } from "@/shared/filter-row.tsx";
import { GridTable } from "@/shared/grid-table.tsx";
import { useKeystroke } from "@/shared/keystrokes.tsx";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { ListHead } from "@/shared/page-head.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Card } from "@/shared/ui/card.tsx";

import { CorrectNameDialog } from "./correct-name-dialog.tsx";
import { correctWords } from "./correcting-words.ts";
import { countOf, NothingListed, ReadSaid, useNarrowedRows } from "./list-parts.tsx";
import { NAMES_WAITING_WORDS as WORDS } from "./list-words.ts";
import { arrival, backToTheName, EVERYONE_PATH, NAMES_WAITING_PATH } from "./people-address.ts";
import { useNamesWaiting, type NameWaiting } from "./people-api.ts";
import { NAMES_WAITING_KEYSTROKES } from "./people-keystrokes.ts";
import { At } from "./person-words.tsx";
import { SignInAgain } from "./sign-in-again.tsx";
import { useCorrecting } from "./use-correcting.ts";
import { NO_NAME_IN_FOCUS } from "./words.ts";

const features = tableFeatures({});

const column = createColumnHelper<typeof features, NameWaiting>();

const correctButtonId = (personId: string): string => `correct-${personId}`;

/** Module-level, so React calls it once as the node mounts, never on a re-render. */
const focusOnArrival = (node: HTMLElement | null) => {
  node?.focus();
};

type NameActions = {
  readonly correct: (personId: string) => void;
  readonly focusedOn: (personId: string) => void;
  /** The person whose action takes focus as it arrives: back from signing in, or refused. */
  readonly personToFocus: string | undefined;
};

function FlaggedName(properties: { readonly waiting: NameWaiting }) {
  const { displayName } = properties.waiting;
  if (displayName === "") return <span className="text-muted-foreground">No display name</span>;
  return <span className="font-medium wrap-anywhere">{displayName}</span>;
}

function Flags(properties: { readonly waiting: NameWaiting }) {
  return (
    <ul className="grid gap-1">
      {properties.waiting.flags.map((flag) => (
        <li key={flag.workspace.id} className="flex flex-wrap gap-x-2">
          <span className="wrap-anywhere">{flag.workspace.name}</span>{" "}
          <span className="text-muted-foreground">
            <At iso={flag.raisedAt} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function CorrectAction(properties: {
  readonly waiting: NameWaiting;
  readonly actions: NameActions;
}) {
  const { waiting, actions } = properties;
  const { personId } = waiting;
  return (
    <Button
      ref={personId === actions.personToFocus ? focusOnArrival : undefined}
      id={correctButtonId(personId)}
      variant="outline"
      size="sm"
      aria-haspopup="dialog"
      aria-label={correctWords(waiting.displayName)}
      aria-keyshortcuts={NAMES_WAITING_KEYSTROKES.correct.key}
      onFocus={() => {
        actions.focusedOn(personId);
      }}
      onClick={() => {
        actions.correct(personId);
      }}
    >
      Correct
    </Button>
  );
}

/** The row's own action corrects it, so the actions ride into the columns. */
const columnsFor = (actions: NameActions) =>
  column.columns([
    column.display({
      id: "person",
      header: "Person",
      cell: ({ row }) => <FlaggedName waiting={row.original} />,
    }),
    column.display({
      id: "flags",
      header: "Flagged by",
      cell: ({ row }) => <Flags waiting={row.original} />,
    }),
    column.display({
      id: "actions",
      header: "Actions",
      cell: ({ row }) => <CorrectAction waiting={row.original} actions={actions} />,
    }),
  ]);

/** A name is found by itself or by a workspace that flagged it; the read carries no address. */
const wordsOf = (waiting: NameWaiting): string =>
  [waiting.displayName, ...waiting.flags.map((flag) => flag.workspace.name)].join("\n");

function NothingWaits() {
  return (
    <div className="grid justify-items-start gap-1 px-4 py-10">
      <p className="font-medium">{WORDS.noneWaiting}</p>
      <p className="text-muted-foreground">{WORDS.whatWaits}</p>
      <Button asChild variant="outline" className="mt-3">
        <Link to={EVERYONE_PATH}>Find a person in Everyone</Link>
      </Button>
    </div>
  );
}

/** `staleFor` names the person refused over a sign-in too old; the way on takes focus. */
function WayOn(properties: { readonly staleFor: string | undefined }) {
  const { staleFor } = properties;
  if (staleFor === undefined) return null;
  return (
    <p className="mt-1">
      <SignInAgain back={backToTheName(staleFor)} linkRef={focusOnArrival} />
    </p>
  );
}

type Correcting = ReturnType<typeof useCorrecting>;

function DialogFor(properties: {
  readonly picked: NameWaiting | undefined;
  readonly correcting: Correcting;
  readonly onSave: (asked: NameWaiting, displayName: string) => void;
  readonly onClose: () => void;
  readonly onFocusBack: (personId: string, saved: boolean) => void;
}) {
  const { picked } = properties;
  if (picked === undefined) return null;
  return (
    <CorrectNameDialog
      key={picked.personId}
      name={picked.displayName}
      displayName={picked.displayName}
      refused={properties.correcting.refusedAt(picked.personId)}
      onSave={(displayName) => {
        properties.onSave(picked, displayName);
      }}
      onClose={properties.onClose}
      onFocusBack={(saved) => {
        properties.onFocusBack(picked.personId, saved);
      }}
    />
  );
}

const NO_NAME: readonly NameWaiting[] = [];

export function NamesWaitingList() {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listed = useNamesWaiting();
  const correcting = useCorrecting();
  const navigate = useNavigate();
  const [arrivedFor] = useState(() => arrival().personId);
  const [inFocus, setInFocus] = useState<string>();
  const [openFor, setOpenFor] = useState<string>();
  const [said, setSaid] = useState<Outcome>();
  // A refused read leaves nothing listed: what it held may no longer be the reader's to see.
  const waiting = listed.error === null ? listed.data : undefined;
  const names = waiting ?? NO_NAME;
  const narrowed = useNarrowedRows(names, wordsOf);
  const personToFocus = correcting.otherwiseRefusedFor ?? arrivedFor;

  const columns = useMemo(
    () => columnsFor({ correct: setOpenFor, focusedOn: setInFocus, personToFocus }),
    [personToFocus],
  );
  const table = useTable({
    features,
    columns,
    data: narrowed.shown,
    getRowId: (each) => each.personId,
  });

  /** A letter pressed outside the list still needs a name it shows, so the one last in focus stands. */
  useKeystroke(NAMES_WAITING_KEYSTROKES.correct, () => {
    const held = narrowed.shown.find((each) => each.personId === inFocus);
    setSaid(held === undefined ? NO_NAME_IN_FOCUS : undefined);
    if (held !== undefined) setOpenFor(held.personId);
  });

  /** The dialog closes first, so the row leaves the list as the dialog does. */
  const save = (asked: NameWaiting, displayName: string) => {
    setOpenFor(undefined);
    setSaid(undefined);
    // The address that brought focus back to this person has served once they are corrected.
    if (asked.personId === arrivedFor) void navigate({ to: NAMES_WAITING_PATH, replace: true });
    correcting.save({ personId: asked.personId, was: asked.displayName, displayName });
  };

  /** A saved name takes its row away, so focus waits on the heading until the api answers. */
  const focusBack = (personId: string, saved: boolean) => {
    const row = saved ? null : document.getElementById(correctButtonId(personId));
    (row ?? headingRef.current)?.focus();
  };

  return (
    <section aria-labelledby={headingId} className="mt-6">
      <ListHead
        heading={WORDS.heading}
        headingId={headingId}
        headingRef={headingRef}
        description={WORDS.description}
        count={waiting === undefined ? "" : countOf(WORDS, names.length, narrowed)}
      />
      <ReadSaid read={listed} loading={WORDS.loading} />
      <OutcomeLine outcome={said ?? correcting.outcome} className="mt-2" />
      <WayOn staleFor={correcting.staleFor} />

      {waiting === undefined ? null : (
        <Card className="mt-4">
          <FilterRow
            search={{
              label: WORDS.search,
              value: narrowed.typed,
              onChange: narrowed.setTyped,
              keystroke: NAMES_WAITING_KEYSTROKES.search,
              inputRef: narrowed.searchRef,
            }}
          />
          <GridTable
            table={table}
            caption={WORDS.caption}
            empty={
              <NothingListed
                search={narrowed.search}
                noneMatch={WORDS.noneMatch}
                onClear={narrowed.clear}
                searchRef={narrowed.searchRef}
              >
                <NothingWaits />
              </NothingListed>
            }
          />
        </Card>
      )}

      <DialogFor
        picked={names.find((each) => each.personId === openFor)}
        correcting={correcting}
        onSave={save}
        onClose={() => {
          setOpenFor(undefined);
        }}
        onFocusBack={focusBack}
      />
    </section>
  );
}
