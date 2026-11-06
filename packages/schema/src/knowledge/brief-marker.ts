/** A marker is `[^<include id>]` in prose. Code holds none, and a definition opens its line. */
const TOKEN = /(?<!\\)(```[\s\S]*?```|`[^`\n]*`)|\[\^([\w-]+)\]/gu;

const OPENS_A_LINE = /^ {0,3}$/u;

const opensALine = (text: string, at: number): boolean =>
  OPENS_A_LINE.test(text.slice(text.lastIndexOf("\n", at - 1) + 1, at));

export type Marker = { readonly label: string; readonly at: number; readonly end: number };

export const markersIn = (markdown: string): readonly Marker[] =>
  [...markdown.matchAll(TOKEN)].flatMap(({ 0: found, 1: code, 2: label, index: at }) => {
    if (code !== undefined || label === undefined) return [];
    const end = at + found.length;
    return markdown[end] === ":" && opensALine(markdown, at) ? [] : [{ label, at, end }];
  });

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
