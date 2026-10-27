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

const TERMINAL = /[.!?]/u;

const CLOSING_QUOTE = new Set(['"', "'", "”", "’", ")"]);

type Mark = { readonly at: number; readonly end: number };

type MarksOfLine = {
  readonly starts: ReadonlySet<number>;
  readonly startOfEnd: ReadonlyMap<number, number>;
};

const runStart = (line: string, mark: Mark, marks: MarksOfLine): number => {
  let start = mark.at;
  for (;;) {
    let before = start;
    while (SPACE.has(line[before - 1] ?? "")) before -= 1;
    const earlier = marks.startOfEnd.get(before);
    if (earlier === undefined) return start;
    start = earlier;
  }
};

const terminalBefore = (line: string, at: number): boolean => {
  let before = at;
  while (CLOSING_QUOTE.has(line[before - 1] ?? "") || SPACE.has(line[before - 1] ?? "")) {
    before -= 1;
  }
  return TERMINAL.test(line[before - 1] ?? "");
};

const endsASentence = (line: string, mark: Mark, at: number, marks: MarksOfLine): boolean =>
  TERMINAL.test(line.slice(mark.end, at)) || terminalBefore(line, runStart(line, mark, marks));

const stopAfter = (
  line: string,
  mark: Mark,
  marks: MarksOfLine,
  lineDone: boolean,
): number | undefined => {
  const at = pastClosing(line, mark.end);
  const next = pastSpace(line, at);
  if (next === line.length) return lineDone ? at : undefined;
  if (next === at || marks.starts.has(next)) return undefined;
  return endsASentence(line, mark, at, marks) ? at : undefined;
};

type Split = { readonly sentences: readonly string[]; readonly rest: string };

const splitLine = (line: string, citable: readonly Citable[], lineDone: boolean): Split => {
  const marks = marksIn(line, citable).map((mark) => ({
    at: mark.at,
    end: mark.at + mark.mark.length,
  }));
  const ofLine: MarksOfLine = {
    starts: new Set(marks.map((mark) => mark.at)),
    startOfEnd: new Map(marks.map((mark) => [mark.end, mark.at])),
  };
  const sentences: string[] = [];
  let from = 0;
  for (const mark of marks) {
    const stop = stopAfter(line, mark, ofLine, lineDone);
    if (stop === undefined || stop <= from) continue;
    sentences.push(line.slice(from, stop));
    from = stop;
  }
  const rest = line.slice(from);
  return lineDone ? { sentences: [...sentences, rest], rest: "" } : { sentences, rest };
};

const written = (sentences: readonly string[]): readonly string[] =>
  sentences.map((sentence) => sentence.trim()).filter((sentence) => sentence !== "");

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

const AN_EARLIER_END = /[.!?]["'”’)]*\s+\S/u;

const tidied = (text: string): string =>
  text
    .replaceAll(/\s+/gu, " ")
    .replaceAll(/ ([.,;:!?])/gu, "$1")
    .trim();

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
  if (shown === "" || shown.includes("[^")) return undefined;
  if (AN_EARLIER_END.test(shown)) return undefined;
  const cited = marks.flatMap((mark) => citable[mark.source]?.iri ?? []);
  return { sentence: shown, concepts: [...new Set(cited)] };
};
