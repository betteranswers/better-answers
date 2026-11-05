import { byWords } from "@/shared/words.ts";

export const THING_NOUNS = {
  "connected-source": "connected source",
  document: "document",
  concept: "concept",
} as const;

export type Thing = keyof typeof THING_NOUNS;

const UNNAMED_BECAUSE = {
  removed: "(removed)",
  withheld: "you don't have access to",
} as const;

export const unnamedWords = (thing: {
  readonly kind: keyof typeof UNNAMED_BECAUSE;
  readonly of: Thing;
}): string => `a ${THING_NOUNS[thing.of]} ${UNNAMED_BECAUSE[thing.kind]}`;

export const GONE_WORDS = {
  "former-member": byWords({ kind: "former-member" }),
  "deleted-group": "a deleted group",
  "erased-invitation": "an erased invitation",
} as const;

export const personSaid = (
  displayName: string,
  address: string,
): { readonly value: string; readonly address?: string } =>
  displayName === "" ? { value: address } : { value: displayName, address };
