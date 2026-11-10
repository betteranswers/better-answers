import type { CitedSource } from "@better-answers/schema";
import { markersIn } from "@better-answers/schema/brief-marker";
import {
  bodyPartsOf,
  cutAt,
  drawnCuts,
  type BodyPart,
} from "@better-answers/schema/cited-markdown";

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

export type RenderedBrief = {
  readonly parts: readonly BodyPart[];
  readonly footnotes: readonly Numbered<Footnote>[];
};

export type ClipboardBrief = Clipboard & { readonly footnotes: number };

const placing = <Cited extends Footnote>(
  markdown: string,
  footnotes: readonly Cited[],
): Placing<Cited> => {
  const byLabel = new Map(footnotes.map((footnote) => [footnote.label, footnote]));
  const cuts = drawnCuts(
    cutAt<Cited>(
      markdown,
      markersIn(markdown).map(({ label, at, end }) => ({ at, end, cited: byLabel.get(label) })),
    ),
  );
  const inOrder = new Map(
    cuts.flatMap((cut) => (cut.kind === "citation" ? [[cut.cited.label, cut.cited]] : [])),
  );
  const cited = [...inOrder.values()].map((footnote, at) => ({ ...footnote, number: at + 1 }));
  const numbers = new Map(cited.map(({ label, number }) => [label, number]));
  return { parts: bodyPartsOf(cuts, ({ label }) => numbers.get(label) ?? 0), cited };
};

const page = (markdown: string, footnotes: readonly Footnote[]): RenderedBrief => {
  const { parts, cited } = placing(markdown, footnotes);
  return { parts, footnotes: cited };
};

const clipboard = (markdown: string, footnotes: readonly SourcedFootnote[]): ClipboardBrief => {
  const { parts, cited } = placing(markdown, footnotes);
  return { ...clipboardOf(parts, cited.map(sourceLineOf)), footnotes: cited.length };
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
