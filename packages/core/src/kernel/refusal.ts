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

export type Vocabulary = Readonly<Record<string, RefusalClass>>;

/** Each owner's vocabulary under the owner's name. */
export type Catalogue = Readonly<Record<string, Vocabulary>>;

export type WordIn<C extends Catalogue> = { [O in keyof C]: Extract<keyof C[O], string> }[keyof C];

export type CataloguedRefusal = {
  readonly word: string;
  readonly class: RefusalClass;
  readonly owner: string;
};

const WORD = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * Every word in `catalogue` with its class and owner, in the order declared.
 *
 * @throws on a word that is not lower case and hyphenated, or one two owners declare.
 */
export const refusalsIn = (catalogue: Catalogue): readonly CataloguedRefusal[] => {
  const held = new Map<string, CataloguedRefusal>();
  for (const [owner, vocabulary] of Object.entries(catalogue)) {
    for (const [word, refusalClass] of Object.entries(vocabulary)) {
      if (!WORD.test(word)) {
        throw new Error(
          `refusal: ${word} is not a refusal word, which is lower case and hyphenated`,
        );
      }
      const first = held.get(word);
      if (first !== undefined) {
        throw new Error(`refusal: ${word} is declared twice, by ${first.owner} and by ${owner}`);
      }
      held.set(word, { word, class: refusalClass, owner });
    }
  }
  return [...held.values()];
};

/**
 * For a transport to index. `Object.assign` over a spread answers `any`, so the return type is
 * this function's own claim.
 *
 * @throws as `refusalsIn` does.
 */
export const classesIn = <const C extends Catalogue>(
  catalogue: C,
): Readonly<Record<WordIn<C>, RefusalClass>> =>
  Object.assign({}, ...refusalsIn(catalogue).map(({ word, class: held }) => ({ [word]: held })));
