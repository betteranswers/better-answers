import type { CitedSource } from "@better-answers/schema";
import { markersIn } from "@better-answers/schema/brief-marker";
import type { BodyPart } from "@better-answers/schema/cited-markdown";

import { clipboardOf, sourceLineOf, type Clipboard } from "./clipboard.ts";

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

type Placing<Cited extends Footnote> = {
  readonly parts: readonly BodyPart[];
  readonly cited: readonly Numbered<Cited>[];
};

/** The page draws its numbers from the citation parts, so no text in the Brief is read as one. */
export type RenderedBrief = {
  readonly parts: readonly BodyPart[];
  readonly footnotes: readonly Numbered<Footnote>[];
};

export type ClipboardBrief = Clipboard & { readonly footnotes: number };

/** A marker the reader cannot read leaves no part. The text either side joins into one, or the split would show where it stood. */
const placing = <Cited extends Footnote>(
  markdown: string,
  footnotes: readonly Cited[],
): Placing<Cited> => {
  const byLabel = new Map(footnotes.map((footnote) => [footnote.label, footnote]));
  const numbered = new Map<string, Numbered<Cited>>();
  const parts: BodyPart[] = [];
  let text = "";
  let from = 0;
  for (const { label, at, end } of markersIn(markdown)) {
    text += markdown.slice(from, at);
    from = end;
    const footnote = byLabel.get(label);
    if (footnote === undefined) continue;
    const cited = numbered.get(label) ?? { ...footnote, number: numbered.size + 1 };
    numbered.set(label, cited);
    if (text !== "") parts.push({ kind: "text", markdown: text });
    parts.push({ kind: "citation", number: cited.number });
    text = "";
  }
  text += markdown.slice(from);
  if (text !== "") parts.push({ kind: "text", markdown: text });
  return { parts, cited: [...numbered.values()] };
};

const page = (markdown: string, footnotes: readonly Footnote[]): RenderedBrief => {
  const { parts, cited } = placing(markdown, footnotes);
  return { parts, footnotes: cited };
};

const clipboard = (markdown: string, footnotes: readonly SourcedFootnote[]): ClipboardBrief => {
  const { parts, cited } = placing(markdown, footnotes);
  return {
    ...clipboardOf(parts, cited.map(sourceLineOf)),
    footnotes: cited.length,
  };
};

/** One document holds many Briefs, each numbering from one, so a markdown footnote would collide. */
const snapshot = (markdown: string, footnotes: readonly SourcedFootnote[]): string => {
  const { parts, cited } = placing(markdown, footnotes);
  const text = parts
    .map((part) => (part.kind === "text" ? part.markdown : `[${String(part.number)}]`))
    .join("");
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
