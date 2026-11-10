import { cutAt, drawnCuts } from "./cited-markdown.ts";

const MARKER = /\[\^([\w-]+)\]/gu;

/** Markdown escapes a bracket after an odd run of backslashes; an even run escapes only itself. */
const isEscaped = (text: string, at: number): boolean => {
  let before = at;
  while (before > 0 && text[before - 1] === "\\") before -= 1;
  return (at - before) % 2 === 1;
};

const OPENS_A_LINE = /^ {0,3}$/u;

const opensADefinition = (text: string, at: number, end: number): boolean =>
  text[end] === ":" && OPENS_A_LINE.test(text.slice(text.lastIndexOf("\n", at - 1) + 1, at));

export type Marker = { readonly label: string; readonly at: number; readonly end: number };

const writtenIn = (markdown: string): readonly Marker[] =>
  [...markdown.matchAll(MARKER)].flatMap(({ 0: found, 1: label, index: at }) => {
    const end = at + found.length;
    if (label === undefined || isEscaped(markdown, at) || opensADefinition(markdown, at, end)) {
      return [];
    }
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
