import {
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
} from "@tanstack/react-table";
import { createContext, useContext } from "react";

import { Address } from "@/shared/address.tsx";
import { RowLink } from "@/shared/grid-table.tsx";
import { initialsOf } from "@/shared/initials.ts";
import type { Said } from "@/shared/refusal-words.ts";
import { Avatar, AvatarFallback } from "@/shared/ui/avatar.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";

import { memberPageOf } from "./members-address.ts";
import type { ListedMember } from "./people-api.ts";
import { Day, GroupPills, nameOf } from "./words.tsx";

export const memberFeatures = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: { text: sortFn_text, basic: sortFn_basic },
});

const column = createColumnHelper<typeof memberFeatures, ListedMember>();

export const SORTABLE: ReadonlySet<string> = new Set(["person", "role", "joined"]);

/** Every column but the person can hide, so a row always says who it is. */
export const HIDEABLE = [
  { id: "role", label: "Role" },
  { id: "groups", label: "Groups" },
  { id: "joined", label: "Joined" },
] as const;

type MemberActions = {
  /** Opens the member's page, where the link alone would lose a search still settling. */
  readonly open: (personId: string) => void;
  readonly focusedOn: (personId: string) => void;
};

/**
 * The list's actions reach each cell here, not through the columns: new columns draw every link
 * afresh, dropping focus a press just gave.
 */
export const MemberActionsContext = createContext<MemberActions | undefined>(undefined);

/** What the last bulk action's refusal said of each person it named. */
export type RefusedRows = ReadonlyMap<string, Said>;

export const NO_MARKS: RefusedRows = new Map();

function PersonCell(properties: {
  readonly member: ListedMember;
  readonly refused: Said | undefined;
}) {
  const { member, refused } = properties;
  const actions = useContext(MemberActionsContext);
  const { personId, displayName, address } = member;
  return (
    <span className="flex min-w-0 items-start gap-2">
      {/* Below the small breakpoint the name needs the room more than its initials do. */}
      <Avatar aria-hidden className="mt-0.5 size-7 max-sm:hidden">
        <AvatarFallback className="text-xs">{initialsOf(nameOf(member))}</AvatarFallback>
      </Avatar>
      <span className="flex min-w-0 flex-col items-start leading-tight">
        <RowLink
          href={memberPageOf(personId)}
          onFocus={() => {
            actions?.focusedOn(personId);
          }}
          onOpen={() => {
            actions?.open(personId);
          }}
        >
          {displayName === "" ? (
            <span className="text-muted-foreground">No display name yet</span>
          ) : (
            displayName
          )}
        </RowLink>
        {/* Still `anywhere`: a cell is as wide as its longest part, which would scroll the table at 320px. */}
        <Address address={address} className="text-xs text-muted-foreground" />
        {refused === undefined ? null : (
          <span className="mt-1 flex flex-wrap items-center gap-1 text-xs">
            <Pill>Refused</Pill>
            {refused.why}
          </span>
        )}
      </span>
    </span>
  );
}

/** The person's own cell says why a bulk action refused them, so the refusals ride in. */
export const memberColumns = (refused: RefusedRows) =>
  column.columns([
    column.accessor((member) => nameOf(member), {
      id: "person",
      header: "Person",
      sortFn: "text",
      cell: ({ row }) => (
        <PersonCell member={row.original} refused={refused.get(row.original.personId)} />
      ),
    }),
    column.accessor("role", {
      id: "role",
      header: "Role",
      sortFn: "text",
      cell: ({ getValue }) => <Pill>{getValue()}</Pill>,
    }),
    column.accessor("groups", {
      id: "groups",
      header: "Groups",
      cell: ({ getValue }) => <GroupPills groups={getValue()} />,
    }),
    column.accessor("joinedAt", {
      id: "joined",
      header: "Joined",
      sortFn: "basic",
      cell: ({ getValue }) => <Day instant={getValue()} />,
    }),
  ]);
