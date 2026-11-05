import type { CitedSource } from "@better-answers/schema";
import { BRIEF_MARKER } from "@better-answers/schema/brief-marker";

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

type Numbering<Cited extends Footnote> = {
  readonly text: string;
  readonly cited: readonly Numbered<Cited>[];
};

export type RenderedBrief = {
  readonly markdown: string;
  readonly footnotes: readonly Numbered<Footnote>[];
};

export type ClipboardBrief = Clipboard & { readonly footnotes: number };

const numbering = <Cited extends Footnote>(
  markdown: string,
  footnotes: readonly Cited[],
  marked: (number: number) => string,
): Numbering<Cited> => {
  const byLabel = new Map(footnotes.map((footnote) => [footnote.label, footnote]));
  const numbered = new Map<string, Numbered<Cited>>();
  const text = markdown.replaceAll(BRIEF_MARKER, (_marker, label: string) => {
    const footnote = byLabel.get(label);
    if (footnote === undefined) return "";
    const cited = numbered.get(label) ?? { ...footnote, number: numbered.size + 1 };
    numbered.set(label, cited);
    return marked(cited.number);
  });
  return { text, cited: [...numbered.values()] };
};

const page = (markdown: string, footnotes: readonly Footnote[]): RenderedBrief => {
  const { text, cited } = numbering(markdown, footnotes, (number) => `[^${String(number)}]`);
  return { markdown: text, footnotes: cited };
};

const clipboard = (markdown: string, footnotes: readonly SourcedFootnote[]): ClipboardBrief => {
  const { text, cited } = numbering(markdown, footnotes, carrierOf);
  return { ...clipboardOf(text, cited.map(sourceLineOf)), footnotes: cited.length };
};

type Renderings = {
  readonly page: { readonly footnote: Footnote; readonly rendered: RenderedBrief };
  readonly clipboard: { readonly footnote: SourcedFootnote; readonly rendered: ClipboardBrief };
};

type Profile = keyof Renderings;

type Profiles = {
  readonly [P in Profile]: (
    markdown: string,
    footnotes: readonly Renderings[P]["footnote"][],
  ) => Renderings[P]["rendered"];
};

const PROFILES: Profiles = { page, clipboard };

export const renderBrief = <P extends Profile>(
  markdown: string,
  footnotes: readonly Renderings[P]["footnote"][],
  profile: P,
): Renderings[P]["rendered"] => PROFILES[profile](markdown, footnotes);
