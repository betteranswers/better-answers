import { collectionNameOf } from "@better-answers/schema/collection-name";

import { CONCEPT_WORDS } from "./concept-words.ts";

export { collectionNameOf };

export const collectionLabelOf = (collection: string | null | undefined): string =>
  collection == null ? CONCEPT_WORDS.noCollection : collectionNameOf(collection);
