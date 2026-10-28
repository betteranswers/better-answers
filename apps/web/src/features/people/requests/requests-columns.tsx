import { createColumnHelper, tableFeatures } from "@tanstack/react-table";
import { createContext, useContext } from "react";

import { Address } from "@/shared/member/address.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";

import { PEOPLE_KEYSTROKES as KEY } from "../people-state.ts";
import { Day } from "../words.tsx";
import { requesterName, type WaitingRequest } from "./requests-api.ts";

export const requestsFeatures = tableFeatures({});

const column = createColumnHelper<typeof requestsFeatures, WaitingRequest>();

type RequestActions = {
  readonly consequenceId: string;
  readonly onApprove: (request: WaitingRequest) => void;
  readonly onDecline: (request: WaitingRequest) => void;
};

export const RequestsActionsContext = createContext<RequestActions | undefined>(undefined);

function Requester(properties: { readonly request: WaitingRequest }) {
  const { name, email } = properties.request.requester;
  return (
    <span className="flex min-w-0 flex-col items-start leading-tight">
      {name === "" ? (
        <span className="text-muted-foreground">No display name yet</span>
      ) : (
        <span className="font-medium">{name}</span>
      )}
      <Address address={email} className="text-xs text-muted-foreground" />
    </span>
  );
}

function Decisions(properties: { readonly request: WaitingRequest }) {
  const actions = useContext(RequestsActionsContext);
  const { request } = properties;
  const name = requesterName(request);
  return (
    <span className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="outline"
        aria-haspopup="dialog"
        aria-label={`Approve Request from ${name}`}
        aria-describedby={actions?.consequenceId}
        aria-keyshortcuts={KEY.approve.key}
        onClick={() => {
          actions?.onApprove(request);
        }}
      >
        Approve
      </Button>
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Decline Request from ${name}`}
        aria-describedby={actions?.consequenceId}
        aria-keyshortcuts={KEY.decline.key}
        onClick={() => {
          actions?.onDecline(request);
        }}
      >
        Decline
      </Button>
    </span>
  );
}

export const REQUESTS_COLUMNS = column.columns([
  column.accessor((request) => requesterName(request), {
    id: "person",
    header: "Person",
    cell: ({ row }) => <Requester request={row.original} />,
  }),
  column.accessor("reason", {
    id: "reason",
    header: "Reason",
    cell: ({ getValue }) => <span className="wrap-anywhere">{getValue()}</span>,
  }),
  column.display({
    id: "state",
    header: "State",
    cell: () => <Pill>Waiting</Pill>,
  }),
  column.accessor("askedAt", {
    id: "asked",
    header: "Asked",
    cell: ({ getValue }) => <Day instant={getValue()} />,
  }),
  column.display({
    id: "actions",
    header: "Actions",
    cell: ({ row }) => <Decisions request={row.original} />,
  }),
]);
