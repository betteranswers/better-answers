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

import { initialsOf } from "@/shared/initials.ts";
import type { Said } from "@/shared/refusal-words.ts";
import { Avatar, AvatarFallback } from "@/shared/ui/avatar.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";

import { memberButtonId } from "./member-sheet.tsx";
import type { ListedMember } from "./people-api.ts";
import { GroupPills, JoinedOn, nameOf } from "./words.tsx";

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

export type MemberActs = {
  readonly open: (personId: string) => void;
  readonly focusedOn: (personId: string) => void;
};

/** What the last bulk act's refusal said of each person it named. */
export type RefusedRows = ReadonlyMap<string, Said>;

function PersonCell(properties: {
  readonly member: ListedMember;
  readonly acts: MemberActs;
  readonly refused: Said | undefined;
}) {
  const { member, acts, refused } = properties;
  const { personId, displayName, address } = member;
  return (
    <span className="flex min-w-0 items-start gap-2">
      {/* Below the small breakpoint the name needs the room more than its initials do. */}
      <Avatar aria-hidden className="mt-0.5 size-7 max-sm:hidden">
        <AvatarFallback className="text-xs">{initialsOf(nameOf(member))}</AvatarFallback>
      </Avatar>
      <span className="flex min-w-0 flex-col items-start leading-tight">
        <Button
          id={memberButtonId(personId)}
          variant="link"
          aria-haspopup="dialog"
          className="h-auto p-0 text-left font-medium whitespace-normal text-foreground"
          onFocus={() => {
            acts.focusedOn(personId);
          }}
          onClick={() => {
            acts.open(personId);
          }}
        >
          {displayName === "" ? (
            <span className="text-muted-foreground">No display name yet</span>
          ) : (
            displayName
          )}
        </Button>
        <span className="text-xs text-muted-foreground wrap-anywhere">{address}</span>
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

/** The person's own cell opens them and says why a bulk act refused them, so both ride in. */
export const memberColumns = (acts: MemberActs, refused: RefusedRows) =>
  column.columns([
    column.accessor((member) => nameOf(member), {
      id: "person",
      header: "Person",
      sortFn: "text",
      cell: ({ row }) => (
        <PersonCell
          member={row.original}
          acts={acts}
          refused={refused.get(row.original.personId)}
        />
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
      cell: ({ getValue }) => <JoinedOn instant={getValue()} />,
    }),
  ]);
