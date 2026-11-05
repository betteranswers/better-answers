import { FilterRow } from "@/shared/list/filter-row.tsx";

import { useKinds, type KindCounted } from "../knowledge-api.ts";
import type { AllKnowledgeAddress, Standing } from "./all-knowledge-address.ts";
import { HIDEABLE } from "./all-knowledge-columns.tsx";
import { choiceOf, YOUR_COLLECTIONS } from "./curation-state.ts";
import { ALL_KNOWLEDGE_WORDS as WORDS } from "./curation-words.ts";

type Choice = { readonly value: string; readonly label: string };

const NO_KINDS: readonly KindCounted[] = [];

const choicesOf = (names: readonly string[], held: string | undefined): readonly Choice[] =>
  [...new Set(held === undefined ? names : [...names, held])]
    .toSorted((one, other) => one.localeCompare(other))
    .map((name) => ({ value: name, label: name }));

const yoursOffered = (standing: Standing): readonly Choice[] =>
  !standing.admin && standing.owned.length > 1
    ? [{ value: YOUR_COLLECTIONS, label: WORDS.filters.collection.yours }]
    : [];

export function AllKnowledgeFilters(properties: {
  readonly standing: Standing;
  readonly address: AllKnowledgeAddress;
  readonly hidden: ReadonlySet<string>;
  readonly onHiddenChange: (hidden: ReadonlySet<string>) => void;
}) {
  const { standing, address } = properties;
  const { scope, state } = address;
  const kinds = useKinds().data?.kinds ?? NO_KINDS;
  const collections = kinds.flatMap((each) =>
    each.collections.flatMap((held) => (held.collection === null ? [] : [held.collection])),
  );
  const heldKind = state.kind === "" ? undefined : state.kind;

  return (
    <FilterRow
      filters={[
        {
          label: WORDS.filters.collection.label,
          value: choiceOf(scope, standing.owned),
          anyLabel: WORDS.filters.collection.any,
          choices: [
            ...yoursOffered(standing),
            ...choicesOf(collections, scope.kind === "one" ? scope.collection : undefined),
          ],
          onChange: address.chooseCollection,
        },
        {
          label: WORDS.filters.kind.label,
          value: heldKind,
          anyLabel: WORDS.filters.kind.any,
          choices: choicesOf(
            kinds.map((each) => each.kind),
            heldKind,
          ),
          onChange: address.chooseKind,
        },
      ]}
      columns={{
        columns: HIDEABLE,
        hidden: properties.hidden,
        onHiddenChange: properties.onHiddenChange,
      }}
    />
  );
}
