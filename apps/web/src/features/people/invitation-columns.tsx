import {
  createColumnHelper,
  createPaginatedRowModel,
  rowPaginationFeature,
  tableFeatures,
} from "@tanstack/react-table";

import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
import { dayWords } from "@/shared/words.ts";

import type { ListedInvitation } from "./invitations-api.ts";

export const invitationFeatures = tableFeatures({
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});

const column = createColumnHelper<typeof invitationFeatures, ListedInvitation>();

/** Every column but the address can hide, so a row always says whose invitation it is. */
export const HIDEABLE = [
  { id: "role", label: "Role" },
  { id: "sent", label: "Sent" },
  { id: "expires", label: "Expires" },
  { id: "invitedBy", label: "Invited by" },
] as const;

/** An accepted or cancelled invitation's expiry no longer bears on anything. */
export const EXPIRY = "expires";

function Day(properties: { readonly instant: string }) {
  return <span className="tabular-nums">{dayWords(properties.instant)}</span>;
}

export const INVITATION_COLUMNS = column.columns([
  column.accessor("address", {
    id: "address",
    header: "Address",
    cell: ({ getValue }) => <span className="font-medium wrap-anywhere">{getValue()}</span>,
  }),
  column.accessor("role", {
    id: "role",
    header: "Role",
    cell: ({ getValue }) => <Pill>{getValue()}</Pill>,
  }),
  column.accessor("invitedAt", {
    id: "sent",
    header: "Sent",
    cell: ({ getValue }) => <Day instant={getValue()} />,
  }),
  column.accessor("expiresAt", {
    id: EXPIRY,
    header: "Expires",
    cell: ({ getValue }) => <Day instant={getValue()} />,
  }),
  column.accessor("invitedBy", {
    id: "invitedBy",
    header: "Invited by",
    cell: ({ getValue }) =>
      getValue() === "" ? (
        <span className="text-muted-foreground">No display name yet</span>
      ) : (
        getValue()
      ),
  }),
]);
