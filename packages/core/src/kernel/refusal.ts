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

export type RefusalOwner = "kernel" | "sources" | "members" | "workspaces" | "transport";

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

export const refusalRegister = (): readonly RegisteredRefusal[] => [...registered.values()];
