import { foldConceptType } from "@better-answers/schema/concept-type";

type ConceptTypeOptions = {
  readonly listed: readonly string[];
  readonly adds: string | undefined;
};

export const sameConceptType = (one: string, other: string): boolean =>
  foldConceptType(one) === foldConceptType(other);

export const storedNameOf = (conceptTypes: readonly string[], value: string): string =>
  conceptTypes.find((each) => sameConceptType(each, value)) ?? value;

export const optionsFor = (conceptTypes: readonly string[], typed: string): ConceptTypeOptions => {
  const named = typed.trim();
  if (named === "") return { listed: conceptTypes, adds: undefined };

  const folded = foldConceptType(named);
  const needle = named.toLowerCase();
  const exact = conceptTypes.filter((each) => foldConceptType(each) === folded);
  const others = conceptTypes.filter((each) => !exact.includes(each));
  const starts = others.filter((each) => each.toLowerCase().startsWith(needle));
  const inside = others.filter(
    (each) => !starts.includes(each) && each.toLowerCase().includes(needle),
  );

  return {
    listed: [...exact, ...starts, ...inside],
    adds: exact.length === 0 ? folded : undefined,
  };
};
