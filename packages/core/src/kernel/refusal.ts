export const REFUSAL_CLASSES = [
  "unauthenticated",
  "forbidden",
  "absent",
  "malformed",
  "inapplicable",
  "conflict",
  "precondition",
] as const;

export type RefusalClass = (typeof REFUSAL_CLASSES)[number];

export type RefusalOwner =
  | "kernel"
  | "sources"
  | "members"
  | "workspaces"
  | "erasure"
  | "transport";

export type Vocabulary = Readonly<Record<string, RefusalClass>>;

export type RegisteredRefusal = {
  readonly word: string;
  readonly class: RefusalClass;
  readonly owner: RefusalOwner;
};

const WORD = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

const registered = new Map<string, RegisteredRefusal>();

const declarationRefusal = (word: string): string | undefined => {
  if (!WORD.test(word)) return `${word} is not a refusal word, which is lower case and hyphenated`;
  if (registered.has(word)) return `${word} is declared twice`;
  return undefined;
};

/**
 * Registers every word under `owner` and hands `words` back for a union to be built from. Nothing
 * registers unless every word does.
 *
 * @throws on a word that is not lower case and hyphenated, or one any owner already declared.
 */
export const declareRefusals = <const V extends Vocabulary>(owner: RefusalOwner, words: V): V => {
  for (const word of Object.keys(words)) {
    const refusal = declarationRefusal(word);
    if (refusal !== undefined) throw new Error(`refusal: ${refusal}`);
  }
  for (const [word, held] of Object.entries(words)) {
    registered.set(word, { word, class: held, owner });
  }
  return words;
};

/**
 * Every word declared so far, in the order declared. A slice's words are there only once its
 * module has loaded.
 */
export const refusalRegister = (): readonly RegisteredRefusal[] => [...registered.values()];
