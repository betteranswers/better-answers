import type { CitedSource } from "@better-answers/schema";
import { replaceMarkers } from "@better-answers/schema/brief-marker";

import { carrierOf, clipboardOf, sourceLineOf, type Clipboard } from "./clipboard.ts";

export type Footnote = {
  readonly label: string;
  readonly iri: string;
  readonly title: string;
};

export type SourcedFootnote = Footnote & {
  readonly sources: readonly CitedSource[];
  readonly wording: string | null;
};

type Numbered<Cited extends Footnote> = Cited & { readonly number: number };

/** Where in the rendered text a footnote number stands. */
type Mark = { readonly at: number; readonly number: number };

type Numbering<Cited extends Footnote> = {
  readonly text: string;
  readonly cited: readonly Numbered<Cited>[];
  readonly marks: readonly Mark[];
};

/** The page reads its footnote numbers from `marks`, so text a dropped marker joins cites nothing. */
export type RenderedBrief = {
  readonly markdown: string;
  readonly footnotes: readonly Numbered<Footnote>[];
  readonly marks: readonly Mark[];
};

export type ClipboardBrief = Clipboard & { readonly footnotes: number };

const numbering = <Cited extends Footnote>(
  markdown: string,
  footnotes: readonly Cited[],
  marked: (number: number) => string,
): Numbering<Cited> => {
  const byLabel = new Map(footnotes.map((footnote) => [footnote.label, footnote]));
  const numbered = new Map<string, Numbered<Cited>>();
  const marks: Mark[] = [];
  let shift = 0;
  const text = replaceMarkers(markdown, (label, at) => {
    const footnote = byLabel.get(label);
    const placedAt = at + shift;
    shift -= `[^${label}]`.length;
    if (footnote === undefined) return "";
    const cited = numbered.get(label) ?? { ...footnote, number: numbered.size + 1 };
    numbered.set(label, cited);
    const replaced = marked(cited.number);
    marks.push({ at: placedAt, number: cited.number });
    shift += replaced.length;
    return replaced;
  });
  return { text, cited: [...numbered.values()], marks };
};

const page = (markdown: string, footnotes: readonly Footnote[]): RenderedBrief => {
  const { text, cited, marks } = numbering(markdown, footnotes, (number) => `[^${String(number)}]`);
  return { markdown: text, footnotes: cited, marks };
};

const clipboard = (markdown: string, footnotes: readonly SourcedFootnote[]): ClipboardBrief => {
  const { text, cited } = numbering(markdown, footnotes, carrierOf);
  return { ...clipboardOf(text, cited.map(sourceLineOf)), footnotes: cited.length };
};

/** One document holds many Briefs, each numbering from one, so a markdown footnote would collide. */
const snapshot = (markdown: string, footnotes: readonly SourcedFootnote[]): string => {
  const { text, cited } = numbering(markdown, footnotes, (number) => `[${String(number)}]`);
  const sources = cited.map((entry) => `${String(entry.number)}. ${sourceLineOf(entry)}`);
  return sources.length === 0
    ? text.trimEnd()
    : `${text.trimEnd()}\n\n**Sources**\n\n${sources.join("\n")}`;
};

type Renderings = {
  readonly page: { readonly footnote: Footnote; readonly rendered: RenderedBrief };
  readonly clipboard: { readonly footnote: SourcedFootnote; readonly rendered: ClipboardBrief };
  readonly snapshot: { readonly footnote: SourcedFootnote; readonly rendered: string };
};

type Profile = keyof Renderings;

type Profiles = {
  readonly [P in Profile]: (
    markdown: string,
    footnotes: readonly Renderings[P]["footnote"][],
  ) => Renderings[P]["rendered"];
};

const PROFILES: Profiles = { page, clipboard, snapshot };

export const renderBrief = <P extends Profile>(
  markdown: string,
  footnotes: readonly Renderings[P]["footnote"][],
  profile: P,
): Renderings[P]["rendered"] => PROFILES[profile](markdown, footnotes);
