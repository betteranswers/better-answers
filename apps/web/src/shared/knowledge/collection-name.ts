import { collectionNameOf } from "@better-answers/schema/collection-name";

import { EMPTY_WORDS } from "./concept-words.ts";

export const collectionLabelOf = (collection: string | null | undefined): string =>
  collection == null ? EMPTY_WORDS.collection : collectionNameOf(collection);
