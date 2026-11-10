import { cutAt, drawnCuts } from "./cited-markdown.ts";

/** `[^<include id>]`, unless a backslash escapes its bracket. */
const WRITTEN = /(?<!\\)\[\^([\w-]+)\]/gu;

const OPENS_A_LINE = /^ {0,3}$/u;

const opensALine = (text: string, at: number): boolean =>
  OPENS_A_LINE.test(text.slice(text.lastIndexOf("\n", at - 1) + 1, at));

export type Marker = { readonly label: string; readonly at: number; readonly end: number };

/** A definition `[^x]:` opens its line, and is no marker. */
const writtenIn = (markdown: string): readonly Marker[] =>
  [...markdown.matchAll(WRITTEN)].flatMap(({ 0: found, 1: label, index: at }) => {
    const end = at + found.length;
    if (label === undefined || (markdown[end] === ":" && opensALine(markdown, at))) return [];
    return [{ label, at, end }];
  });

/** The markers the Brief's parse draws. One in code, raw HTML, alt text or a typed footnote stays as typed. */
export const markersIn = (markdown: string): readonly Marker[] =>
  drawnCuts(
    cutAt(
      markdown,
      writtenIn(markdown).map((marker) => ({ ...marker, cited: marker })),
    ),
  ).flatMap((cut) => (cut.kind === "citation" ? [cut.cited] : []));

export const markersOf = (markdown: string): readonly string[] =>
  markersIn(markdown).map(({ label }) => label);

export const replaceMarkers = (
  markdown: string,
  replacement: (label: string) => string,
): string => {
  let replaced = "";
  let from = 0;
  for (const { label, at, end } of markersIn(markdown)) {
    replaced += markdown.slice(from, at) + replacement(label);
    from = end;
  }
  return replaced + markdown.slice(from);
};
