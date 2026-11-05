/** A marker is `[^<include id>]`. A definition (`[^x]:`) is no marker. */
export const BRIEF_MARKER = /\[\^([\w-]+)\](?!:)/gu;

export const markersOf = (markdown: string): readonly string[] =>
  Array.from(markdown.matchAll(BRIEF_MARKER), ([, label]) => label ?? "");
