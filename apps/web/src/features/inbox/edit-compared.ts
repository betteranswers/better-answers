import type { ConceptParts } from "./inbox-api.ts";

export type Paragraph = { readonly text: string; readonly changed: boolean };

export type Compared = {
  readonly current: readonly Paragraph[];
  readonly proposed: readonly Paragraph[];
};

const paragraphsOf = (body: string): readonly string[] =>
  body
    .replaceAll("\r\n", "\n")
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");

const markedAgainst = (own: readonly string[], other: readonly string[]): readonly Paragraph[] => {
  const kept = new Set(other);
  return own.map((text) => ({ text, changed: !kept.has(text) }));
};

export const paragraphsCompared = (current: string | null, proposed: string): Compared => {
  const now = paragraphsOf(proposed);
  if (current === null) return { current: [], proposed: markedAgainst(now, now) };
  const was = paragraphsOf(current);
  return { current: markedAgainst(was, now), proposed: markedAgainst(now, was) };
};

type Source = Extract<NonNullable<ConceptParts["sources"]>, readonly unknown[]>[number];

const wordsOfField = (value: string | number | boolean | null | undefined): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

const sourceWords = (source: Source): string =>
  typeof source === "string"
    ? source
    : (wordsOfField(source["title"]) ?? wordsOfField(source["resource"]) ?? "");

export const sourceLinesOf = (sources: ConceptParts["sources"]): readonly string[] =>
  Array.isArray(sources) ? sources.map(sourceWords).filter((line) => line !== "") : [];
