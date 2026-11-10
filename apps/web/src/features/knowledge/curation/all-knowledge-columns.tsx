import { createColumnHelper, tableFeatures } from "@tanstack/react-table";
import { createContext, useContext } from "react";

import { collectionNameOf } from "@/shared/knowledge/collection-name.ts";
import { conceptMatchKey } from "@/shared/knowledge/concept-address.ts";
import { ConceptLink } from "@/shared/knowledge/concept-link.tsx";
import { TrustMark } from "@/shared/knowledge/trust-mark.tsx";

import type { AllKnowledgeRow } from "../knowledge-api.ts";
import { ALL_KNOWLEDGE_WORDS as WORDS } from "./curation-words.ts";

export const allKnowledgeFeatures = tableFeatures({});

const column = createColumnHelper<typeof allKnowledgeFeatures, AllKnowledgeRow>();

export const HIDEABLE = [
  { id: "type", label: WORDS.columns.type },
  { id: "collection", label: WORDS.columns.collection },
  { id: "trust", label: WORDS.columns.trust },
  { id: "owner", label: WORDS.columns.owner },
] as const;

export const NARROW_HIDES: ReadonlySet<string> = new Set(["type", "collection", "owner"]);

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
    <div className="min-w-28">
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

function TrustCell(properties: { readonly concept: AllKnowledgeRow }) {
  const { checkedOn, trust, trustWords } = properties.concept;
  const wordsCarryTheDate = trust.status === "current" && trust.tier === "human-reviewed";
  return (
    <span className="flex min-w-36 flex-col items-start gap-1">
      <TrustMark trust={trust} words={trustWords} />
      {checkedOn === null || wordsCarryTheDate ? null : (
        <span className="text-xs text-muted-foreground">{WORDS.lastVerified(checkedOn)}</span>
      )}
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
    id: "type",
    header: WORDS.columns.type,
    cell: ({ getValue }) => getValue(),
  }),
  column.accessor("collection", {
    id: "collection",
    header: WORDS.columns.collection,
    cell: ({ getValue }) => {
      const collection = getValue();
      return collection === null ? WORDS.noCollection : collectionNameOf(collection);
    },
  }),
  column.accessor("trustWords", {
    id: "trust",
    header: WORDS.columns.trust,
    cell: ({ row }) => <TrustCell concept={row.original} />,
  }),
  column.accessor("owner", {
    id: "owner",
    header: WORDS.columns.owner,
    cell: ({ getValue }) => <OwnerCell owner={getValue()} />,
  }),
]);
