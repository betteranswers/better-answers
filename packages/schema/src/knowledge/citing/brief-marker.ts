import { cutAt, drawnCuts } from "./cited-markdown.ts";

const UNESCAPED_MARKER = /(?<!\\)\[\^([\w-]+)\]/gu;

const OPENS_A_LINE = /^ {0,3}$/u;

const opensADefinition = (text: string, at: number, end: number): boolean =>
  text[end] === ":" && OPENS_A_LINE.test(text.slice(text.lastIndexOf("\n", at - 1) + 1, at));

export type Marker = { readonly label: string; readonly at: number; readonly end: number };

const writtenIn = (markdown: string): readonly Marker[] =>
  [...markdown.matchAll(UNESCAPED_MARKER)].flatMap(({ 0: found, 1: label, index: at }) => {
    const end = at + found.length;
    if (label === undefined || opensADefinition(markdown, at, end)) return [];
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
