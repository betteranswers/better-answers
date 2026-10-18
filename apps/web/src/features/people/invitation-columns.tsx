import {
  createColumnHelper,
  createPaginatedRowModel,
  rowPaginationFeature,
  tableFeatures,
} from "@tanstack/react-table";

import { Address } from "@/shared/address.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";

import { isActable } from "./invitations-address.ts";
import type { InvitationStatus, ListedInvitation } from "./invitations-api.ts";
import { Day } from "./words.tsx";

export const invitationFeatures = tableFeatures({
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});

const column = createColumnHelper<typeof invitationFeatures, ListedInvitation>();

const ROLE = { id: "role", label: "Role" } as const;

const SENT = { id: "sent", label: "Sent" } as const;

const EXPIRY = { id: "expires", label: "Expires" } as const;

const INVITED_BY = { id: "invitedBy", label: "Invited By" } as const;

const HIDEABLE = [ROLE, SENT, EXPIRY, INVITED_BY] as const;

export const NARROW_HIDES: ReadonlySet<string> = new Set([SENT.id, EXPIRY.id, INVITED_BY.id]);

export const columnsUnder = (status: InvitationStatus, hidden: ReadonlySet<string>) =>
  isActable(status)
    ? { hideable: HIDEABLE, hidden }
    : {
        hideable: HIDEABLE.filter((one) => one.id !== EXPIRY.id),
        hidden: new Set([...hidden, EXPIRY.id]),
      };

export const INVITATION_COLUMNS = column.columns([
  column.accessor("address", {
    id: "address",
    header: "Address",
    cell: ({ getValue }) => <Address address={getValue()} className="font-medium" />,
  }),
  column.accessor("role", {
    id: ROLE.id,
    header: ROLE.label,
    cell: ({ getValue }) => <Pill>{getValue()}</Pill>,
  }),
  column.accessor("invitedAt", {
    id: SENT.id,
    header: SENT.label,
    cell: ({ getValue }) => <Day instant={getValue()} />,
  }),
  column.accessor("expiresAt", {
    id: EXPIRY.id,
    header: EXPIRY.label,
    cell: ({ getValue }) => <Day instant={getValue()} />,
  }),
  column.accessor("invitedBy", {
    id: INVITED_BY.id,
    header: INVITED_BY.label,
    cell: ({ getValue }) =>
      getValue() === "" ? (
        <span className="text-muted-foreground">No display name yet</span>
      ) : (
        getValue()
      ),
  }),
]);
