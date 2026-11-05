import { CONCEPT_WORDS } from "@/shared/knowledge/concept-words.ts";
import type { OwnSentences } from "@/shared/refusal-words.ts";
import { counted } from "@/shared/words.ts";

export const ALL_KNOWLEDGE_WORDS = {} as const;

const kindsCounted = (count: number): string => counted(count, "kind", "kinds");

export const KINDS_WORDS = {
  about:
    "A kind is the type of a concept, in the word its writer chose. Each count covers only the concepts you can read.",
  loading: "The kinds are still loading.",
  none: "No kinds to show yet. A kind appears here once it holds a concept you can read.",
  noneSmall: "Every kind holds more than two concepts.",
  caption: "Kinds of concept in the knowledge base, with how many concepts hold each.",
  count: (shown: number, total: number): string =>
    shown === total ? kindsCounted(total) : `${shown} of ${kindsCounted(total)}`,
  columns: { kind: "Kind", concepts: "Concepts" },
  tail: "Kinds With Two or Fewer Concepts",
  byCollection: "by collection",
  collectionsOf: (kind: string): string => `Concepts of ${kind} by collection`,
  noCollection: CONCEPT_WORDS.noCollection,
  selectFirst: "Please select a kind first.",
  refusals: {
    "owner-forbids": "You no longer own a collection, so this page is no longer open to you.",
    "role-forbids": "Only Admins and the owners of a collection can see the kinds.",
  } satisfies OwnSentences,
} as const;

export const EXPORTS_WORDS = {} as const;
