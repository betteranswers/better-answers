import type { ConceptIri } from "@better-answers/schema";
import { linksAndMarksOf } from "@better-answers/schema/concept-file";

import type { DraftedSentence } from "./record.ts";

export type Citable = { readonly label: string; readonly iri: ConceptIri };

const marksIn = (text: string, citable: readonly Citable[]) =>
  linksAndMarksOf(
    text,
    citable.map(({ label, iri }) => ({ resource: iri, locator: null, id: label })),
  ).marks;

const CLOSING = new Set([".", ",", ";", ":", "!", "?", ")", '"', "'", "”", "’"]);

const SPACE = new Set([" ", "\t"]);

const pastSpace = (line: string, at: number): number => {
  let next = at;
  while (SPACE.has(line[next] ?? "")) next += 1;
  return next;
};

const pastClosing = (line: string, end: number): number => {
  let at = end;
  while (CLOSING.has(line[at] ?? "")) at += 1;
  return at;
};

/**
 * A sentence ending in the mark that ends at `end` stops after its punctuation, once a space
 * follows and no further mark does.
 */
const stopAfter = (
  line: string,
  end: number,
  markStarts: ReadonlySet<number>,
  lineDone: boolean,
): number | undefined => {
  const at = pastClosing(line, end);
  const next = pastSpace(line, at);
  // Nothing follows yet: more marks may still arrive, until the line is done.
  if (next === line.length) return lineDone ? at : undefined;
  if (next === at) return undefined;
  return markStarts.has(next) ? undefined : at;
};

type Split = { readonly sentences: readonly string[]; readonly rest: string };

/** A line cut after each sentence its marks end; the tail is a sentence too once the line is done. */
const splitLine = (line: string, citable: readonly Citable[], lineDone: boolean): Split => {
  const marks = marksIn(line, citable);
  const markStarts = new Set(marks.map((mark) => mark.at));
  const sentences: string[] = [];
  let from = 0;
  for (const mark of marks) {
    const stop = stopAfter(line, mark.at + mark.mark.length, markStarts, lineDone);
    if (stop === undefined || stop <= from) continue;
    sentences.push(line.slice(from, stop));
    from = stop;
  }
  const rest = line.slice(from);
  return lineDone ? { sentences: [...sentences, rest], rest: "" } : { sentences, rest };
};

const written = (sentences: readonly string[]): readonly string[] =>
  sentences.map((sentence) => sentence.trim()).filter((sentence) => sentence !== "");

/**
 * The sentences finished in `buffered`, and what is left to read. A sentence ends with its line,
 * or after its marks and their closing punctuation once a space follows them. When the reply has
 * `ended`, what is left is a sentence too.
 */
export const finishedSentences = (
  buffered: string,
  citable: readonly Citable[],
  ended: boolean,
): Split => {
  const lines = buffered.split("\n");
  const last = lines.pop() ?? "";
  const done = lines.flatMap((line) => splitLine(line, citable, true).sentences);
  const tail = splitLine(last, citable, ended);
  return { sentences: written([...done, ...tail.sentences]), rest: tail.rest };
};

/** A sentence's end with more text after it: an abbreviation reads as one too, and is refused. */
const AN_EARLIER_END = /[.!?]["'”’)]*\s+\S/;

/** Space left where a mark was taken out goes, and so does any before the punctuation after it. */
const tidied = (text: string): string =>
  text
    .replaceAll(/\s+/g, " ")
    .replaceAll(/ ([.,;:!?])/g, "$1")
    .trim();

/**
 * The sentence as a reader sees it, with the concepts its marks cite, when every footnote in it
 * names one of `citable` and it has one at least. Anything else is no sentence to show.
 */
export const checkedSentence = (
  sentence: string,
  citable: readonly Citable[],
): DraftedSentence | undefined => {
  const marks = marksIn(sentence, citable);
  if (marks.length === 0) return undefined;
  let shown = "";
  let from = 0;
  for (const mark of marks) {
    shown += sentence.slice(from, mark.at);
    from = mark.at + mark.mark.length;
  }
  shown = tidied(shown + sentence.slice(from));
  // A footnote left after the marks were taken out names nothing a reader was given.
  if (shown === "" || shown.includes("[^")) return undefined;
  // A second sentence here may be one no mark cites, so the whole is refused.
  if (AN_EARLIER_END.test(shown)) return undefined;
  const cited = marks.flatMap((mark) => citable[mark.source]?.iri ?? []);
  return { sentence: shown, concepts: [...new Set(cited)] };
};
