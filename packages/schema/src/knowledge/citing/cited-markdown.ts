import type { Node, Nodes, Root } from "mdast";
import type { CompileContext, Extension as TreeExtension, Token } from "mdast-util-from-markdown";
import type { Extension as SyntaxExtension, State, Tokenizer } from "micromark-util-types";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/** A body as its readers draw it. A citation is a whole part, so leaving one out reads no text as another. */
export type BodyPart =
  | { readonly kind: "text"; readonly markdown: string }
  | { readonly kind: "citation"; readonly number: number };

/** The citation in this place among a body's citations, numbered as its reader sees it. */
export interface Citation extends Node {
  readonly type: "citation";
  readonly place: number;
  readonly number: number;
}

declare module "mdast" {
  interface PhrasingContentMap {
    citation: Citation;
  }
  interface RootContentMap {
    citation: Citation;
  }
}

declare module "micromark-util-types" {
  interface TokenTypeMap {
    citation: "citation";
  }
}

/** Where each citation ends in the Markdown that stands in for the body, and which citation it is. */
export type Citations = ReadonlyMap<number, Pick<Citation, "place" | "number">>;

export type CitedMarkdown = { readonly markdown: string; readonly citations: Citations };

/** U+E000 opens no Markdown construct. Its `<` ends a bare address, and its brackets flank emphasis as a marker's do. */
const STAND_IN = "<>";

const STRAY = new RegExp(STAND_IN, "gu");

/** The parser skips a byte order mark that opens its input, and counts offsets from after it. */
const BYTE_ORDER_MARK = "﻿";

export const citedMarkdownOf = (parts: readonly BodyPart[]): CitedMarkdown => {
  let markdown = "";
  const ends: (readonly [number, Pick<Citation, "place" | "number">])[] = [];
  for (const part of parts) {
    markdown += part.kind === "text" ? part.markdown : STAND_IN;
    if (part.kind === "citation") {
      ends.push([markdown.length, { place: ends.length, number: part.number }]);
    }
  }
  const skipped = markdown.startsWith(BYTE_ORDER_MARK) ? BYTE_ORDER_MARK.length : 0;
  return { markdown, citations: new Map(ends.map(([end, placed]) => [end - skipped, placed])) };
};

export const isBlank = (parts: readonly BodyPart[]): boolean =>
  parts.every((part) => part.kind === "text" && part.markdown.trim() === "");

const LESS_THAN = 0x3c;

const GREATER_THAN = 0x3e;

const BACKSLASH = 0x5c;

const STANDS_IN = [LESS_THAN, 0xe000, GREATER_THAN] as const;

const tokenizing =
  (codes: readonly number[]): Tokenizer =>
  (effects, ok, nok) => {
    const at =
      (index: number): State =>
      (code) => {
        if (code !== codes[index]) return nok(code);
        effects.consume(code);
        if (index + 1 < codes.length) return at(index + 1);
        effects.exit("citation");
        return ok;
      };
    return (code) => {
      effects.enter("citation");
      return at(0)(code);
    };
  };

/** A backslash before the stand-in would escape its bracket, so the stand-in takes the backslash. */
const SYNTAX: SyntaxExtension = {
  text: {
    [LESS_THAN]: { name: "citation", tokenize: tokenizing(STANDS_IN) },
    [BACKSLASH]: {
      name: "escapedCitation",
      tokenize: tokenizing([BACKSLASH, ...STANDS_IN]),
      add: "before",
    },
  },
};

const treeOf = (citations: Citations): TreeExtension => ({
  enter: {
    citation(this: CompileContext, token: Token) {
      const placed = citations.get(token.end.offset);
      const node: Nodes =
        placed === undefined ? { type: "text", value: "" } : { type: "citation", ...placed };
      this.enter(node, token);
    },
  },
  exit: {
    citation(this: CompileContext, token: Token) {
      this.exit(token);
    },
  },
});

/** The parser reads no stand-in inside code or a link destination, so it is stripped there. */
const withoutStrays = (tree: Root): Root => {
  const pending: Nodes[] = [tree];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if ("children" in node) pending.push(...node.children);
    if ("value" in node) node.value = node.value.replaceAll(STRAY, "");
    if ("url" in node) node.url = node.url.replaceAll(STRAY, "");
  }
  return tree;
};

type Registry = {
  micromarkExtensions?: SyntaxExtension[];
  fromMarkdownExtensions?: (TreeExtension | TreeExtension[])[];
};

/** The parse holds a `citation` node only where `citedMarkdownOf` placed one. */
export function remarkCitations(
  this: { data(): Registry },
  citations: Citations,
): (tree: Root) => Root {
  const data = this.data();
  data.micromarkExtensions = [...(data.micromarkExtensions ?? []), SYNTAX];
  data.fromMarkdownExtensions = [...(data.fromMarkdownExtensions ?? []), treeOf(citations)];
  return withoutStrays;
}

const parsed = ({ markdown, citations }: CitedMarkdown): Root => {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkCitations, citations);
  return processor.runSync(processor.parse(markdown));
};

export const citedTreeOf = (parts: readonly BodyPart[]): Root => parsed(citedMarkdownOf(parts));

/** A body cut where its citations stand. Each citation keeps the text it replaced. */
export type Cut<Cited> =
  | { readonly kind: "text"; readonly markdown: string }
  | { readonly kind: "citation"; readonly cited: Cited; readonly written: string };

export type Span<Cited> = {
  readonly at: number;
  readonly end: number;
  readonly cited: Cited | undefined;
};

const cutAt = <Cited>(body: string, spans: readonly Span<Cited>[]): readonly Cut<Cited>[] => {
  const cuts: Cut<Cited>[] = [];
  let from = 0;
  for (const { at, end, cited } of spans) {
    cuts.push({ kind: "text", markdown: body.slice(from, at) });
    if (cited !== undefined) cuts.push({ kind: "citation", cited, written: body.slice(at, end) });
    from = end;
  }
  cuts.push({ kind: "text", markdown: body.slice(from) });
  return cuts;
};

/** Text parts joined and empty ones dropped, so a cut leaves no trace in the parts. */
export const bodyPartsOf = <Cited>(
  cuts: readonly Cut<Cited>[],
  numberOf: (cited: Cited) => number,
): readonly BodyPart[] => {
  const parts: BodyPart[] = [];
  let text = "";
  for (const cut of cuts) {
    if (cut.kind === "text") {
      text += cut.markdown;
      continue;
    }
    if (text !== "") parts.push({ kind: "text", markdown: text });
    parts.push({ kind: "citation", number: numberOf(cut.cited) });
    text = "";
  }
  if (text !== "") parts.push({ kind: "text", markdown: text });
  return parts;
};

type Reading = { readonly drawn: ReadonlySet<number>; readonly inCode: ReadonlySet<number> };

type Range = readonly [start: number, end: number];

const shownNodesOf = (tree: Root): readonly Nodes[] => {
  const shown: Nodes[] = [];
  const pending: Nodes[] = [tree];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    shown.push(node);
    if ("children" in node && node.type !== "footnoteDefinition") pending.push(...node.children);
  }
  return shown;
};

const codeRangeOf = (node: Nodes): readonly Range[] =>
  (node.type === "code" || node.type === "inlineCode") && node.position !== undefined
    ? [[node.position.start.offset ?? 0, node.position.end.offset ?? 0]]
    : [];

const readingOf = (parts: readonly BodyPart[]): Reading => {
  const cited = citedMarkdownOf(parts);
  const shown = shownNodesOf(parsed(cited));
  const code = shown.flatMap(codeRangeOf);
  const inCode = [...cited.citations].flatMap(([end, { place }]) =>
    code.some(([start, stop]) => start <= end - STAND_IN.length && end <= stop) ? [place] : [],
  );
  return {
    drawn: new Set(shown.flatMap((node) => (node.type === "citation" ? [node.place] : []))),
    inCode: new Set(inCode),
  };
};

const placesOf = <Cited>(cuts: readonly Cut<Cited>[]): readonly (number | undefined)[] => {
  const places: (number | undefined)[] = [];
  let next = 0;
  for (const cut of cuts) {
    places.push(cut.kind === "citation" ? next : undefined);
    if (cut.kind === "citation") next += 1;
  }
  return places;
};

const drawnCuts = <Cited>(cuts: readonly Cut<Cited>[]): readonly Cut<Cited>[] => {
  const { drawn, inCode } = readingOf(bodyPartsOf(cuts, () => 0));
  const places = placesOf(cuts);
  if (places.every((place) => place === undefined || drawn.has(place))) return cuts;
  return drawnCuts(
    cuts.map((cut, at): Cut<Cited> => {
      const place = places[at];
      if (cut.kind === "text" || place === undefined || drawn.has(place)) return cut;
      return { kind: "text", markdown: inCode.has(place) ? cut.written : "" };
    }),
  );
};

/** The body cut at its spans, citing only where the parse draws. An undrawn citation shows as typed in code, elsewhere as nothing. */
export const drawnCutsOf = <Cited>(
  body: string,
  spans: readonly Span<Cited>[],
): readonly Cut<Cited>[] => drawnCuts(cutAt(body, spans));
