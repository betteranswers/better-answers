import { Link, useNavigate } from "@tanstack/react-router";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useMemo, useState, type RefObject } from "react";

import { GridTable } from "@/shared/grid-table.tsx";
import { useKeystroke } from "@/shared/keystrokes.tsx";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { Button } from "@/shared/ui/button.tsx";

import { CorrectNameDialog } from "./correct-name-dialog.tsx";
import { arrival, backToTheName, EVERYONE_PATH, NAMES_WAITING_PATH } from "./people-address.ts";
import { useNamesWaiting, type NameWaiting } from "./people-api.ts";
import { NAMES_WAITING_KEYSTROKES } from "./people-keystrokes.ts";
import { At } from "./person-words.tsx";
import { RefusalLine } from "./refusal-line.tsx";
import { SignInAgain } from "./sign-in-again.tsx";
import { useCorrecting } from "./use-correcting.ts";
import { correctWords, readRefused } from "./words.ts";

const features = tableFeatures({});

const column = createColumnHelper<typeof features, NameWaiting>();

const NOTHING_IN_FOCUS: Outcome = {
  tone: "said",
  words: "Move focus to a name first: the keystroke acts on the name in focus.",
};

const correctButtonId = (personId: string): string => `correct-${personId}`;

/** Module-level, so React calls it once as the node mounts, never on a re-render. */
const focusOnArrival = (node: HTMLElement | null) => {
  node?.focus();
};

type NameActs = {
  readonly correct: (personId: string) => void;
  readonly focusedOn: (personId: string) => void;
  /** The person whose act takes focus as it arrives: back from signing in, or refused. */
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

function CorrectAct(properties: { readonly waiting: NameWaiting; readonly acts: NameActs }) {
  const { waiting, acts } = properties;
  const { personId } = waiting;
  return (
    <Button
      ref={personId === acts.personToFocus ? focusOnArrival : undefined}
      id={correctButtonId(personId)}
      variant="outline"
      size="sm"
      aria-haspopup="dialog"
      aria-label={correctWords(waiting.displayName)}
      aria-keyshortcuts={NAMES_WAITING_KEYSTROKES.correct.key}
      onFocus={() => {
        acts.focusedOn(personId);
      }}
      onClick={() => {
        acts.correct(personId);
      }}
    >
      Correct
    </Button>
  );
}

/** The row's own act corrects it, so the acts ride into the columns. */
const columnsFor = (acts: NameActs) =>
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
      id: "acts",
      header: "Acts",
      cell: ({ row }) => <CorrectAct waiting={row.original} acts={acts} />,
    }),
  ]);

type Listed = ReturnType<typeof useNamesWaiting>;

const countSaid = (listed: Listed): string => {
  if (listed.data === undefined) return "The names waiting are still loading.";
  const count = listed.data.length;
  if (count === 0) return "No name waits to be corrected.";
  return count === 1 ? "1 name waits to be corrected." : `${count} names wait to be corrected.`;
};

function NothingWaits() {
  return (
    <div className="grid justify-items-start gap-1 px-4 py-10">
      <p className="font-medium">Every flagged name is corrected.</p>
      <p className="text-muted-foreground">
        A name an Admin flags from their workspace's People screen waits here until you correct it.
      </p>
      <Button asChild variant="outline" className="mt-3">
        <Link to={EVERYONE_PATH}>Find a person in Everyone</Link>
      </Button>
    </div>
  );
}

/** `staleFor` names the person refused over a sign-in too old; the way on takes focus. */
function ListSaid(properties: {
  readonly listed: Listed;
  readonly outcome: Outcome | undefined;
  readonly staleFor: string | undefined;
}) {
  const { listed, staleFor } = properties;
  return (
    <>
      <output className="mt-1 block text-muted-foreground">
        {listed.error === null ? countSaid(listed) : <RefusalLine {...readRefused(listed.error)} />}
      </output>
      <OutcomeLine outcome={properties.outcome} className="mt-2" />
      {staleFor === undefined ? null : (
        <p className="mt-1">
          <SignInAgain back={backToTheName(staleFor)} linkRef={focusOnArrival} />
        </p>
      )}
    </>
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

export function NamesWaitingList(properties: {
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const { headingRef } = properties;
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
  const personToFocus = correcting.otherwiseRefusedFor ?? arrivedFor;

  const columns = useMemo(
    () => columnsFor({ correct: setOpenFor, focusedOn: setInFocus, personToFocus }),
    [personToFocus],
  );
  const table = useTable({ features, columns, data: names, getRowId: (each) => each.personId });

  /** A letter pressed outside the list still needs a name, so the one last in focus stands. */
  useKeystroke(NAMES_WAITING_KEYSTROKES.correct, () => {
    const held = names.find((each) => each.personId === inFocus);
    setSaid(held === undefined ? NOTHING_IN_FOCUS : undefined);
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
    <>
      <ListSaid
        listed={listed}
        outcome={said ?? correcting.outcome}
        staleFor={correcting.staleFor}
      />

      {waiting === undefined ? null : (
        <div className="mt-4 border border-border bg-card">
          <GridTable
            table={table}
            caption="Every display name an Admin flagged and nobody has corrected since, the longest waiting first, with the workspaces that flagged it and when. Each row's act corrects the name."
            empty={<NothingWaits />}
          />
        </div>
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
    </>
  );
}
