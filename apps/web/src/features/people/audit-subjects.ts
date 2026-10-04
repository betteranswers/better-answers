import { byWords } from "@/shared/words.ts";

/** The things an event names by a name of their own. */
export const THING_NOUNS = {
  "connected-source": "connected source",
  document: "document",
  concept: "concept",
} as const;

export type Thing = keyof typeof THING_NOUNS;

/** A thing since removed is said by its kind alone. */
export const removedWords = (of: Thing): string => `a ${THING_NOUNS[of]} (removed)`;

export const GONE_WORDS = {
  "former-member": byWords({ kind: "former-member" }),
  "deleted-group": "a deleted group",
  "erased-invitation": "an erased invitation",
} as const;

/** A person with no display name yet is named by their address, so it is not said twice. */
export const personSaid = (
  displayName: string,
  address: string,
): { readonly value: string; readonly address?: string } =>
  displayName === "" ? { value: address } : { value: displayName, address };
