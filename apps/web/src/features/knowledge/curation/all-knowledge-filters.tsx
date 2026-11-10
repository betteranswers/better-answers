import { collectionNameOf } from "@/shared/knowledge/collection-name.ts";
import { FilterRow } from "@/shared/list/filter-row.tsx";

import { useConceptTypes, type ConceptTypeCounted } from "../knowledge-api.ts";
import type { AllKnowledgeAddress, Standing } from "./all-knowledge-address.ts";
import { HIDEABLE } from "./all-knowledge-columns.tsx";
import { choiceOf, TRUSTS, YOUR_COLLECTIONS } from "./curation-state.ts";
import { ALL_KNOWLEDGE_WORDS as WORDS } from "./curation-words.ts";

type Choice = { readonly value: string; readonly label: string };

const NO_CONCEPT_TYPES: readonly ConceptTypeCounted[] = [];

const choicesOf = (
  names: readonly string[],
  held: string | undefined,
  labelOf: (name: string) => string = (name) => name,
): readonly Choice[] =>
  [...new Set(held === undefined ? names : [...names, held])]
    .toSorted((one, other) => one.localeCompare(other))
    .map((name) => ({ value: name, label: labelOf(name) }));

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
  const conceptTypes = useConceptTypes().data?.conceptTypes ?? NO_CONCEPT_TYPES;
  const collections = conceptTypes.flatMap((each) =>
    each.collections.flatMap((held) => (held.collection === null ? [] : [held.collection])),
  );
  const heldConceptType = state.type === "" ? undefined : state.type;

  return (
    <FilterRow
      filters={[
        {
          label: WORDS.filters.collection.label,
          value: choiceOf(scope, standing.owned),
          anyLabel: WORDS.filters.collection.any,
          choices: [
            ...yoursOffered(standing),
            ...choicesOf(
              collections,
              scope.kind === "one" ? scope.collection : undefined,
              collectionNameOf,
            ),
          ],
          onChange: address.chooseCollection,
        },
        {
          label: WORDS.filters.type.label,
          value: heldConceptType,
          anyLabel: WORDS.filters.type.any,
          choices: choicesOf(
            conceptTypes.map((each) => each.conceptType),
            heldConceptType,
          ),
          onChange: address.chooseConceptType,
        },
        {
          label: WORDS.filters.trust.label,
          value: state.trust,
          anyLabel: WORDS.filters.trust.any,
          choices: TRUSTS.map((trust) => ({
            value: trust,
            label: WORDS.filters.trust.choices[trust],
          })),
          onChange: address.chooseTrust,
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
