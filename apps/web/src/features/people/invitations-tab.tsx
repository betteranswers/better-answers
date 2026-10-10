import { useTable } from "@tanstack/react-table";
import { useId, useMemo, useRef, useState, type RefObject } from "react";

import { FilterRow } from "@/shared/filter-row.tsx";
import { GridTable } from "@/shared/grid-table.tsx";
import { useKeystroke } from "@/shared/keystrokes.tsx";
import { ListPages, ListRead, ListState } from "@/shared/list-pages.tsx";
import { OutcomeLine, selectFirst, type Outcome } from "@/shared/outcome.tsx";
import { ListHead } from "@/shared/page-head.tsx";
import { RowMenu } from "@/shared/row-menu.tsx";
import { useSearchedList } from "@/shared/searched-list.ts";
import { SelectionBar } from "@/shared/selection-bar.tsx";
import { Card } from "@/shared/ui/card.tsx";
import { useHiddenColumns } from "@/shared/wide-layout.ts";

import {
  InvitationBulkActions,
  NONE,
  useInvitationActions,
  type Ticked,
} from "./invitation-actions.tsx";
import {
  columnsUnder,
  INVITATION_COLUMNS,
  invitationFeatures,
  NARROW_HIDES,
} from "./invitation-columns.tsx";
import { INVITATIONS_WORDS as WORDS, STATUS_WORDS } from "./invitation-words.ts";
import {
  DEFAULT_STATUS,
  INVITATION_STATUSES,
  INVITATIONS_FIELDS,
  INVITATIONS_LIST,
  isActable,
} from "./invitations-address.ts";
import {
  useInvitationCounts,
  useInvitations,
  type ListedInvitation,
  type SentInvitation,
} from "./invitations-api.ts";
import { InviteAction } from "./invite-action.tsx";
import { PEOPLE_KEYSTROKES as KEY, PEOPLE_SELECT_FIRST } from "./people-state.ts";
import { outcomeOfInvitationFailure } from "./refusal.tsx";
import { UnsentEmails } from "./unsent-emails.tsx";

/** Each status's list is read whole, so the browser pages it. */
const PAGE_SIZE = 25;

const INVITATIONS_HEADING = "Invitations";

const NOTHING_IN_FOCUS = selectFirst(PEOPLE_SELECT_FIRST.invitation);

const NO_ONE: readonly ListedInvitation[] = [];

const NOTHING_UNSENT: readonly SentInvitation[] = [];

const matching = (search: string) => {
  const sought = search.toLowerCase();
  return (invitation: ListedInvitation): boolean =>
    invitation.address.toLowerCase().includes(sought);
};

/** A clear empties the search and stays on the status the reader chose. */
const KEPT_ON_CLEAR = ["status"] as const;

const useNarrowedInvitations = () => {
  const list = useSearchedList(INVITATIONS_LIST, INVITATIONS_FIELDS, KEPT_ON_CLEAR);
  const read = useInvitations(list.state.status);
  const listed = read.data ?? NO_ONE;
  const { search } = list;
  const data = useMemo(() => listed.filter(matching(search)), [listed, search]);
  return { ...list, read, listed, data, pageIndex: list.pageIndex(PAGE_SIZE, data.length) };
};

type Narrowed = ReturnType<typeof useNarrowedInvitations>;

const countSaid = (narrowed: Narrowed): string => {
  const { state, listed, data, search } = narrowed;
  if (listed.length === 0) return "";
  return search === ""
    ? WORDS.counted(state.status, listed.length)
    : WORDS.matched(state.status, data.length, listed.length, search);
};

function InvitationFilters(properties: {
  readonly narrowed: Narrowed;
  readonly searchRef: RefObject<HTMLInputElement | null>;
  readonly hidden: ReadonlySet<string>;
  readonly onHiddenChange: (hidden: ReadonlySet<string>) => void;
}) {
  const { narrowed } = properties;
  const counts = useInvitationCounts().data;
  return (
    <FilterRow
      search={{
        label: WORDS.search,
        value: narrowed.search,
        onChange: narrowed.setSearch,
        keystroke: KEY.searchInvitations,
        inputRef: properties.searchRef,
      }}
      status={{
        label: WORDS.status,
        value: narrowed.state.status,
        choices: INVITATION_STATUSES.map((status) => ({
          value: status,
          label: STATUS_WORDS[status],
          count: counts?.[status],
        })),
        onChange: (status) => {
          const chosen = INVITATION_STATUSES.find((one) => one === status) ?? DEFAULT_STATUS;
          narrowed.write({ status: chosen, page: 1 });
        },
      }}
      columns={{
        columns: columnsUnder(narrowed.state.status, properties.hidden).hideable,
        hidden: properties.hidden,
        onHiddenChange: properties.onHiddenChange,
      }}
    />
  );
}

function NoneShown(properties: {
  readonly narrowed: Narrowed;
  readonly focusAfterClear: RefObject<HTMLElement | null>;
}) {
  const { narrowed } = properties;
  if (narrowed.search === "") {
    return (
      <ListState
        state={{ kind: "empty", words: WORDS.noneIn[narrowed.state.status], action: undefined }}
      />
    );
  }
  return (
    <ListState
      state={{
        kind: "emptied",
        words: WORDS.noneMatch(narrowed.search),
        onClear: narrowed.clear,
        focusAfterClear: properties.focusAfterClear,
      }}
    />
  );
}

/** A tick taken on another status or page keeps the address it was taken with. */
const tickedFrom =
  (ticked: Ticked, listed: readonly ListedInvitation[]) =>
  (ids: ReadonlySet<string>): Ticked =>
    new Map(
      [...ids].map((invitationId) => [
        invitationId,
        ticked.get(invitationId) ??
          listed.find((invitation) => invitation.invitationId === invitationId)?.address ??
          WORDS.noLongerListed,
      ]),
    );

/** The row focus is in stands while the list still holds it. */
const useInFocusKeystrokes = (properties: {
  readonly inFocus: ListedInvitation | undefined;
  readonly resend: (invitation: ListedInvitation) => void;
  readonly cancel: (invitation: ListedInvitation) => void;
  readonly tick: (invitation: ListedInvitation) => void;
  readonly nothingInFocus: () => void;
}) => {
  const { inFocus, nothingInFocus } = properties;
  const onTheRowInFocus = (action: (invitation: ListedInvitation) => void) => () => {
    if (inFocus === undefined) nothingInFocus();
    else action(inFocus);
  };
  useKeystroke(KEY.resend, onTheRowInFocus(properties.resend));
  useKeystroke(KEY.cancel, onTheRowInFocus(properties.cancel));
  useKeystroke(KEY.tickInvitation, onTheRowInFocus(properties.tick));
};

/** An action that takes its row away hands focus to the list once the menu has shut. */
const rowMenuOf =
  (actions: ReturnType<typeof useInvitationActions>, heading: RefObject<HTMLElement | null>) =>
  (invitation: ListedInvitation) => {
    const toTheList = () => heading.current;
    return (
      <RowMenu
        name={invitation.address}
        actions={[
          {
            label: WORDS.resend,
            onSelect: () => {
              actions.resendOne(invitation);
            },
            focusAfter: invitation.status === "expired" ? toTheList : undefined,
          },
          {
            label: WORDS.cancel,
            destructive: true,
            onSelect: () => {
              actions.cancelOne(invitation);
            },
            focusAfter: toTheList,
          },
        ]}
      />
    );
  };

/** Ticks and an action's outcome are the page's; what narrows the rows is the address's. */
function InvitationList(properties: {
  readonly headingId: string;
  readonly heading: RefObject<HTMLHeadingElement | null>;
}) {
  const { heading } = properties;
  const narrowed = useNarrowedInvitations();
  const { read, listed, state } = narrowed;
  const actable = isActable(state.status);
  // A tick outlives its row and its status, so the next action refuses or skips it and says so.
  const [ticked, setTicked] = useState<Ticked>(NONE);
  const [inFocusId, setInFocusId] = useState<string>();
  const [outcome, setOutcome] = useState<Outcome>();
  const [unsent, setUnsent] = useState(NOTHING_UNSENT);
  const [hidden, setHidden] = useHiddenColumns(NARROW_HIDES);
  const searchRef = useRef<HTMLInputElement>(null);

  const table = useTable({
    features: invitationFeatures,
    columns: INVITATION_COLUMNS,
    data: narrowed.data,
    getRowId: (invitation) => invitation.invitationId,
    state: { pagination: { pageIndex: narrowed.pageIndex, pageSize: PAGE_SIZE } },
  });
  const shownIds = () => table.getRowModel().rows.map((row) => row.id);
  const tickedIds = new Set(ticked.keys());
  const tick = tickedFrom(ticked, listed);

  const actions = useInvitationActions({
    readable: read.isSuccess,
    ticked,
    tick: setTicked,
    heading,
    say: setOutcome,
    unsent: setUnsent,
  });

  useInFocusKeystrokes({
    inFocus: listed.find((invitation) => invitation.invitationId === inFocusId),
    resend: actions.resendOne,
    cancel: actions.cancelOne,
    tick: (invitation) => {
      const next = new Set(tickedIds);
      if (!next.delete(invitation.invitationId)) next.add(invitation.invitationId);
      setTicked(tick(next));
    },
    nothingInFocus: () => {
      setOutcome(NOTHING_IN_FOCUS);
    },
  });

  return (
    <>
      <ListHead
        heading={INVITATIONS_HEADING}
        headingId={properties.headingId}
        headingRef={heading}
        count={read.data === undefined ? "" : countSaid(narrowed)}
        action={<InviteAction />}
      />
      <OutcomeLine outcome={outcome} className="mt-2" />
      <UnsentEmails unsent={unsent} />

      <Card className="mt-4">
        <InvitationFilters
          narrowed={narrowed}
          searchRef={searchRef}
          hidden={hidden}
          onHiddenChange={setHidden}
        />
        <ListRead
          read={read}
          loading={WORDS.loading}
          failed={(failure) => outcomeOfInvitationFailure(failure, "read").words}
          focusAfterRetry={searchRef}
        >
          <SelectionBar
            label={WORDS.selected}
            ticked={tickedIds}
            shown={shownIds()}
            noun={["invitation", "invitations"]}
            clearKeystroke={KEY.clearSelection}
            onClear={() => {
              setTicked(NONE);
            }}
            focusAfterClear={heading}
          >
            <InvitationBulkActions actions={actions} />
          </SelectionBar>
          <GridTable
            table={table}
            caption={WORDS.caption}
            ticking={
              actable
                ? {
                    ticked: tickedIds,
                    onTickedChange: (ids) => {
                      setTicked(tick(ids));
                    },
                    nameOf: (invitation) => invitation.address,
                    everyOnThePage: WORDS.everyOnThePage,
                  }
                : undefined
            }
            hidden={columnsUnder(state.status, hidden).hidden}
            rowMenu={actable ? rowMenuOf(actions, heading) : undefined}
            onRowFocus={(invitation) => {
              setInFocusId(invitation?.invitationId);
            }}
            empty={<NoneShown narrowed={narrowed} focusAfterClear={searchRef} />}
          />
          <ListPages
            pages={{
              kind: "pages",
              label: WORDS.pages,
              pageIndex: narrowed.pageIndex,
              pageSize: PAGE_SIZE,
              total: narrowed.data.length,
              onTurn: (pageIndex) => {
                narrowed.write({ page: pageIndex + 1 });
              },
              keystrokes: { previous: KEY.previousInvitations, next: KEY.nextInvitations },
            }}
          />
        </ListRead>
      </Card>
    </>
  );
}

export function InvitationsTab() {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);

  return (
    <section aria-labelledby={headingId} className="mt-6">
      {/* Its heading is focusable, so focus lands there when an action takes the row it was in. */}
      <InvitationList headingId={headingId} heading={heading} />
    </section>
  );
}
