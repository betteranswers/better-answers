import { useRouterState } from "@tanstack/react-router";
import { useState } from "react";

import { useListAddress } from "@/shared/address/list-address.ts";
import { ALL_KNOWLEDGE_PAGE } from "@/shared/knowledge/concept-address.ts";

import {
  ALL_KNOWLEDGE_FIELDS,
  ALL_KNOWLEDGE_LIST,
  allKnowledgeAsked,
  heldFor,
  isNarrowed,
  scopeOf,
  sortedOf,
  sortOf,
} from "./curation-state.ts";

export type Standing = { readonly admin: boolean; readonly owned: readonly string[] };

/** The router moves the location to the next page before this one leaves the screen, and that location holds none of this page's fields. */
const useWhileOnThisPage = <Held>(held: Held): Held => {
  const here = useRouterState({
    select: (state) => state.location.pathname === ALL_KNOWLEDGE_PAGE.path,
  });
  const [lastHere, setLastHere] = useState(held);
  if (here && lastHere !== held) setLastHere(held);
  return here ? held : lastHere;
};

export const useAllKnowledgeAddress = ({ admin, owned }: Standing) => {
  const listed = useListAddress(ALL_KNOWLEDGE_LIST, ALL_KNOWLEDGE_FIELDS);
  const { write } = listed;
  const state = useWhileOnThisPage(listed.state);
  const scope = scopeOf(state.collection, !admin);
  return {
    state,
    scope,
    narrowed: isNarrowed(state, scope),
    asked: allKnowledgeAsked(state, scope, owned),
    sorted: sortedOf(state.sort),
    sortBy: (next: { readonly id: string; readonly desc: boolean }) => {
      write({ sort: sortOf(next), page: 1 });
    },
    turnTo: (page: number) => {
      write({ page });
    },
    chooseCollection: (choice: string | undefined) => {
      write({ collection: heldFor(choice, !admin), page: 1 });
    },
    chooseKind: (conceptType: string | undefined) => {
      write({ kind: conceptType ?? "", page: 1 });
    },
    clearFilters: () => {
      write({ collection: heldFor(undefined, !admin), kind: "", page: 1 });
    },
  };
};

export type AllKnowledgeAddress = ReturnType<typeof useAllKnowledgeAddress>;
