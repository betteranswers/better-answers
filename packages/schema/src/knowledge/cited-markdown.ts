import type { Node, Nodes, Root } from "mdast";
import type { CompileContext, Extension as TreeExtension, Token } from "mdast-util-from-markdown";
import type { Extension as SyntaxExtension, State, Tokenizer } from "micromark-util-types";

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

/** U+E000 opens no Markdown construct. Its brackets end a bare address and keep emphasis, as a marker's do. */
const STAND_IN = "<\uE000>";

const STRAY = new RegExp(STAND_IN, "gu");

/** The parser skips a byte order mark that opens its input, and counts offsets from after it. */
const BYTE_ORDER_MARK = "\uFEFF";

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

/** A citation is the stand-in that ends where a citation part was placed. Any other reads as nothing. */
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

/** Where the parser meets the stand-in outside prose, in code or an address, it shows nothing. */
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
