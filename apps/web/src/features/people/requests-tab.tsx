import { useTable } from "@tanstack/react-table";
import { useId, useMemo, useRef, useState, type RefObject } from "react";

import { FilterRow } from "@/shared/filter-row.tsx";
import { GridTable } from "@/shared/grid-table.tsx";
import { useKeystroke } from "@/shared/keystrokes.tsx";
import { ListRead, ListState, NothingListed } from "@/shared/list-pages.tsx";
import { OutcomeLine, selectFirst, type Outcome } from "@/shared/outcome.tsx";
import { ListHead } from "@/shared/page-head.tsx";
import { useSearchedList } from "@/shared/searched-list.ts";
import { Card } from "@/shared/ui/card.tsx";
import { counted, nothingMatches } from "@/shared/words.ts";

import { ApproveRequest } from "./approve-request.tsx";
import { EMPTY_LINES } from "./empty-lines.ts";
import { approvedOutcome } from "./invitation-words.ts";
import { useInviteAction } from "./invite-action.tsx";
import type { Role } from "./people-api.ts";
import { PEOPLE_KEYSTROKES as KEY, PEOPLE_SELECT_FIRST } from "./people-state.ts";
import { outcomeOfRequestFailure } from "./refusal.tsx";
import { REQUESTS_FIELDS, REQUESTS_LIST } from "./requests-address.ts";
import {
  requesterName,
  useApproveRequest,
  useDeclineRequest,
  useRequests,
  type WaitingRequest,
} from "./requests-api.ts";
import { REQUESTS_COLUMNS, RequestsActionsContext, requestsFeatures } from "./requests-columns.tsx";
import { aRole } from "./role-meanings.ts";
import { UnsentEmails } from "./unsent-emails.tsx";

const REQUESTS_HEADING = "Requests";

const SEARCH_LABEL = "Search by name or address";

const LOADING = "The requests are still loading.";

const NOTHING_IN_FOCUS = selectFirst(PEOPLE_SELECT_FIRST.request);

const NO_ONE: readonly WaitingRequest[] = [];

const countOf = (waiting: number): string =>
  counted(waiting, "request waiting", "requests waiting");

const saidOfCount = (shown: number, total: number, search: string): string =>
  search === ""
    ? countOf(total)
    : `${String(shown)} of ${counted(total, "request", "requests")} match “${search}”.`;

const matching = (search: string) => {
  const sought = search.toLowerCase();
  return (request: WaitingRequest): boolean =>
    `${requesterName(request)} ${request.requester.email}`.toLowerCase().includes(sought);
};

const useNarrowedRequests = () => {
  const list = useSearchedList(REQUESTS_LIST, REQUESTS_FIELDS);
  const read = useRequests();
  const listed = read.data ?? NO_ONE;
  const { search } = list;
  const data = useMemo(() => listed.filter(matching(search)), [listed, search]);
  return { ...list, read, listed, data };
};

const useInFocusKeystrokes = (properties: {
  readonly inFocus: WaitingRequest | undefined;
  readonly approve: (request: WaitingRequest) => void;
  readonly decline: (request: WaitingRequest) => void;
  readonly nothingInFocus: () => void;
}) => {
  const { inFocus, nothingInFocus } = properties;
  const onTheRowInFocus = (act: (request: WaitingRequest) => void) => () => {
    if (inFocus === undefined) nothingInFocus();
    else act(inFocus);
  };
  useKeystroke(KEY.approve, onTheRowInFocus(properties.approve));
  useKeystroke(KEY.decline, onTheRowInFocus(properties.decline));
};

function RequestsList(properties: {
  readonly headingId: string;
  readonly heading: RefObject<HTMLHeadingElement | null>;
}) {
  const { heading } = properties;
  const narrowed = useNarrowedRequests();
  const { read, listed, search, data } = narrowed;
  const [inFocusId, setInFocusId] = useState<string>();
  const [outcome, setOutcome] = useState<Outcome>();
  const invite = useInviteAction(setOutcome);
  const [approving, setApproving] = useState<WaitingRequest>();
  const searchRef = useRef<HTMLInputElement>(null);
  const openedFrom = useRef<HTMLElement | null>(null);
  const consequenceId = useId();
  const approve = useApproveRequest();
  const decline = useDeclineRequest();
  const inFocus = listed.find((request) => request.id === inFocusId);

  const table = useTable({
    features: requestsFeatures,
    columns: REQUESTS_COLUMNS,
    data,
    getRowId: (request) => request.id,
  });

  const toApprove = (request: WaitingRequest) => {
    const { activeElement } = document;
    openedFrom.current = activeElement instanceof HTMLElement ? activeElement : null;
    setApproving(request);
  };

  const focusBack = (sent: boolean) => {
    const from = openedFrom.current;
    (sent || from?.isConnected !== true ? heading.current : from)?.focus();
  };

  const approved = (request: WaitingRequest, role: Role) => {
    setApproving(undefined);
    setOutcome({
      tone: "said",
      words: `Approving the request from ${requesterName(request)} as ${aRole(role)}.`,
    });
    approve.mutate(
      { requestId: request.id, role },
      {
        onSuccess: (invited) => {
          setOutcome(approvedOutcome(invited));
        },
        onError: (failure) => {
          setOutcome(outcomeOfRequestFailure(failure, "action"));
        },
      },
    );
  };

  const declined = (request: WaitingRequest) => {
    heading.current?.focus();
    setOutcome({
      tone: "said",
      words: `The request from ${requesterName(request)} has been declined. They can ask again.`,
    });
    decline.mutate(
      { requestId: request.id },
      {
        onError: (failure) => {
          setOutcome(outcomeOfRequestFailure(failure, "action"));
        },
      },
    );
  };

  useInFocusKeystrokes({
    inFocus,
    approve: toApprove,
    decline: declined,
    nothingInFocus: () => {
      setOutcome(NOTHING_IN_FOCUS);
    },
  });

  return (
    <>
      <ListHead
        heading={REQUESTS_HEADING}
        headingId={properties.headingId}
        headingRef={heading}
        count={read.data === undefined ? "" : saidOfCount(data.length, listed.length, search)}
        action={invite.action}
      />
      <OutcomeLine outcome={outcome} className="mt-2" />
      <UnsentEmails unsent={invite.unsent} />

      <Card className="mt-4">
        <FilterRow
          search={{
            label: SEARCH_LABEL,
            value: search,
            onChange: narrowed.setSearch,
            keystroke: KEY.searchRequests,
            inputRef: searchRef,
          }}
        />
        <ListRead
          read={read}
          loading={LOADING}
          failed={(failure) => outcomeOfRequestFailure(failure, "read").words}
          focusAfterRetry={searchRef}
        >
          <p id={consequenceId} className="px-3 pt-3 text-muted-foreground">
            Approving a request sends the person an invitation. Declining sends nothing.
          </p>
          <RequestsActionsContext
            value={{ consequenceId, onApprove: toApprove, onDecline: declined }}
          >
            <GridTable
              table={table}
              caption="Requests to join this workspace."
              onRowFocus={(request) => {
                setInFocusId(request?.id);
              }}
              empty={
                <NothingListed
                  search={search}
                  noneMatch={nothingMatches}
                  onClear={narrowed.clear}
                  searchRef={searchRef}
                >
                  <ListState
                    state={{ kind: "empty", words: EMPTY_LINES.requests, action: undefined }}
                  />
                </NothingListed>
              }
            />
          </RequestsActionsContext>
        </ListRead>
      </Card>

      {approving === undefined ? null : (
        <ApproveRequest
          key={approving.id}
          request={approving}
          onApprove={(role) => {
            approved(approving, role);
          }}
          onClose={() => {
            setApproving(undefined);
          }}
          onFocusBack={focusBack}
        />
      )}
    </>
  );
}

export function RequestsTab() {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);

  return (
    <section aria-labelledby={headingId} className="mt-6">
      <RequestsList headingId={headingId} heading={heading} />
    </section>
  );
}
