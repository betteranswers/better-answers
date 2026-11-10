import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { createContext, useContext } from "react";

import { collectionNameOf } from "@better-answers/schema/collection-name";

import { EMPTY_WORDS } from "@/shared/knowledge/concept-words.ts";
import { GridTable } from "@/shared/list/grid-table.tsx";
import { ListState } from "@/shared/list/list-pages.tsx";
import { useHiddenColumns } from "@/shared/page/wide-layout.ts";

import type { CollectionOwned } from "../knowledge-api.ts";
import { COLLECTIONS_WORDS as WORDS } from "../knowledge-words.ts";
import { nameOf, type Naming } from "./owner-naming.ts";
import { OwnerPicker } from "./owner-picker.tsx";

const features = tableFeatures({});

const column = createColumnHelper<typeof features, CollectionOwned>();

const NARROW_HIDES: ReadonlySet<string> = new Set(["verified"]);

const verifiedPercent = ({ verified, concepts }: CollectionOwned): number =>
  concepts === 0 ? 0 : Math.max(Math.floor((verified * 100) / concepts), verified > 0 ? 1 : 0);

const NamingContext = createContext<Naming | undefined>(undefined);

function OwnerCell(properties: { readonly owned: CollectionOwned }) {
  const { owned } = properties;
  const naming = useContext(NamingContext);
  const change = naming?.changeOf(owned.collection);
  return (
    <div className="grid max-w-64 min-w-36 gap-1">
      {naming === undefined ? (
        <span>{owned.owner === null ? EMPTY_WORDS.owner : nameOf(owned.owner)}</span>
      ) : (
        <OwnerPicker
          owned={owned}
          choices={naming.choices}
          saving={change?.state === "saving"}
          onPick={(chosen) => {
            naming.save(owned, chosen);
          }}
        />
      )}
      <div role="alert" className="empty:hidden">
        {change?.state === "refused" ? change.words : null}
      </div>
      {owned.overrides === 0 ? null : (
        <span className="text-xs text-muted-foreground">{WORDS.ownOwners(owned.overrides)}</span>
      )}
    </div>
  );
}

const COLUMNS = column.columns([
  column.accessor("collection", {
    id: "collection",
    header: WORDS.columns.collection,
    cell: ({ getValue }) => (
      <span className="block min-w-20 font-medium wrap-anywhere">
        {collectionNameOf(getValue())}
      </span>
    ),
  }),
  column.accessor("owner", {
    id: "owner",
    header: WORDS.columns.owner,
    cell: ({ row }) => <OwnerCell owned={row.original} />,
  }),
  column.accessor("concepts", {
    id: "concepts",
    header: WORDS.columns.concepts,
    cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span>,
  }),
  column.accessor("verified", {
    id: "verified",
    header: WORDS.columns.verified,
    cell: ({ row }) => (
      <span className="tabular-nums">{WORDS.verifiedShare(verifiedPercent(row.original))}</span>
    ),
  }),
]);

export function CollectionsTable(properties: {
  readonly listed: readonly CollectionOwned[];
  readonly naming: Naming | undefined;
}) {
  const [hidden] = useHiddenColumns(NARROW_HIDES);
  const table = useTable({
    features,
    columns: COLUMNS,
    data: properties.listed,
    getRowId: (owned) => owned.collection,
  });

  return (
    <NamingContext value={properties.naming}>
      <GridTable
        table={table}
        caption={WORDS.caption}
        hidden={hidden}
        empty={<ListState state={{ kind: "empty", words: WORDS.none, action: null }} />}
      />
    </NamingContext>
  );
}
