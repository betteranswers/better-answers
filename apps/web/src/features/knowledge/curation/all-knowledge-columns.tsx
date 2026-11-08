import { createColumnHelper, tableFeatures } from "@tanstack/react-table";
import { createContext, useContext } from "react";

import { conceptMatchKey } from "@/shared/knowledge/concept-address.ts";
import { ConceptLink } from "@/shared/knowledge/concept-link.tsx";
import { TrustMark } from "@/shared/knowledge/trust-mark.tsx";

import type { AllKnowledgeRow } from "../knowledge-api.ts";
import { ALL_KNOWLEDGE_WORDS as WORDS } from "./curation-words.ts";

export const allKnowledgeFeatures = tableFeatures({});

const column = createColumnHelper<typeof allKnowledgeFeatures, AllKnowledgeRow>();

export const HIDEABLE = [
  { id: "kind", label: WORDS.columns.kind },
  { id: "collection", label: WORDS.columns.collection },
  { id: "trust", label: WORDS.columns.trust },
  { id: "owner", label: WORDS.columns.owner },
  { id: "checked", label: WORDS.columns.checked },
] as const;

export const NARROW_HIDES: ReadonlySet<string> = new Set(["kind", "trust"]);

export type Opening = {
  readonly returnedTo: string | undefined;
  readonly onLanded: () => void;
};

/** The columns stay one constant, because a cell that is a new function is drawn afresh and loses focus. */
export const OpeningContext = createContext<Opening>({
  returnedTo: undefined,
  onLanded: () => undefined,
});

function TitleCell(properties: { readonly concept: AllKnowledgeRow }) {
  const { concept } = properties;
  const opening = useContext(OpeningContext);
  return (
    <div className="min-w-36">
      <ConceptLink
        concept={concept}
        landsHere={opening.returnedTo === conceptMatchKey(concept.iri)}
        onLanded={opening.onLanded}
      />
    </div>
  );
}

function OwnerCell(properties: { readonly owner: AllKnowledgeRow["owner"] }) {
  const { owner } = properties;
  if (owner === null) return <span className="text-muted-foreground">{WORDS.unowned}</span>;
  return (
    <span className="flex flex-col leading-tight">
      <span>{owner.name === "" ? WORDS.unnamed : owner.name}</span>
      {owner.own ? <span className="text-xs text-muted-foreground">{WORDS.ownOwner}</span> : null}
    </span>
  );
}

function CheckedCell(properties: { readonly concept: AllKnowledgeRow }) {
  const { checkedBy, checkedOn, trust } = properties.concept;
  if (checkedBy === null && checkedOn === null) {
    return <span className="text-muted-foreground">{WORDS.notChecked}</span>;
  }
  const by =
    trust.tier === "machine-confirmed"
      ? WORDS.automatically
      : checkedBy === null
        ? null
        : WORDS.checkedBy(checkedBy);
  return (
    <span className="flex flex-col leading-tight">
      {checkedOn === null ? null : <span>{checkedOn}</span>}
      {by === null ? null : <span className="text-xs text-muted-foreground">{by}</span>}
    </span>
  );
}

export const allKnowledgeColumns = column.columns([
  column.accessor("title", {
    id: "title",
    header: WORDS.columns.title,
    cell: ({ row }) => <TitleCell concept={row.original} />,
  }),
  column.accessor("conceptType", {
    id: "kind",
    header: WORDS.columns.kind,
    cell: ({ getValue }) => getValue(),
  }),
  column.accessor("collection", {
    id: "collection",
    header: WORDS.columns.collection,
    cell: ({ getValue }) => getValue() ?? WORDS.noCollection,
  }),
  column.accessor("trustWords", {
    id: "trust",
    header: WORDS.columns.trust,
    cell: ({ row }) => (
      <TrustMark
        trust={row.original.trust}
        words={row.original.trustWords}
        className="whitespace-nowrap"
      />
    ),
  }),
  column.accessor("owner", {
    id: "owner",
    header: WORDS.columns.owner,
    cell: ({ getValue }) => <OwnerCell owner={getValue()} />,
  }),
  column.accessor("checkedOn", {
    id: "checked",
    header: WORDS.columns.checked,
    cell: ({ row }) => <CheckedCell concept={row.original} />,
  }),
]);
