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

export type Catalogue = Readonly<Record<string, Vocabulary>>;

export type WordIn<C extends Catalogue> = { [O in keyof C]: Extract<keyof C[O], string> }[keyof C];

export type CataloguedRefusal = {
  readonly word: string;
  readonly class: RefusalClass;
  readonly owner: string;
};

const WORD = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

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

const classesEvery = <C extends Catalogue>(
  classes: Readonly<Record<string, RefusalClass>>,
  catalogue: C,
): classes is Readonly<Record<WordIn<C>, RefusalClass>> =>
  Object.values(catalogue).every((vocabulary) =>
    Object.keys(vocabulary).every((word) => Object.hasOwn(classes, word)),
  );

export const classesIn = <const C extends Catalogue>(
  catalogue: C,
): Readonly<Record<WordIn<C>, RefusalClass>> => {
  const classes = Object.fromEntries(
    refusalsIn(catalogue).map(({ word, class: held }) => [word, held] as const),
  );
  if (!classesEvery(classes, catalogue)) {
    throw new Error("refusal: a catalogued word has no class");
  }
  return classes;
};
