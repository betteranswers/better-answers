import { randomUUID } from "node:crypto";

import type { BlockContent, DefinitionContent, PhrasingContent, RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { IRI, quotedPassageOf, type CitedSource } from "@better-answers/schema";

/** No copy holds the nonce, so no text in a Brief, typed or as a character reference, forges a carrier. */
const OPENS = `\uE000${randomUUID()}`;

const CLOSES = "\uE001";

const CARRIED = new RegExp(`${OPENS}(\\d+)${CLOSES}`, "u");

const CARRIED_ANYWHERE = new RegExp(`${OPENS}\\d+${CLOSES}`, "gu");

export const carrierOf = (number: number): string => `${OPENS}${String(number)}${CLOSES}`;

export type Clipboard = { readonly html: string; readonly text: string };

const NOTHING: Clipboard = { html: "", text: "" };

type Tagged = { readonly type: string };

type Of<Union extends Tagged, Type extends Union["type"]> = Extract<Union, { readonly type: Type }>;

type Readers<Union extends Tagged> = {
  readonly [Type in Union["type"]]: (node: Of<Union, Type>, footnotes: number) => Clipboard;
};

type Flow = BlockContent | DefinitionContent;

const ESCAPED = new Map([
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
  ['"', "&quot;"],
  ["'", "&#39;"],
]);

const escaped = (words: string): string =>
  words.replaceAll(/[&<>"']/gu, (character) => ESCAPED.get(character) ?? character);

const SAFE_LINK = /^(?:https?:|mailto:)/iu;

const around = (inner: Clipboard, tag: string): Clipboard => ({
  html: `<${tag}>${inner.html}</${tag}>`,
  text: inner.text,
});

const gathered = (parts: readonly Clipboard[], between: string): Clipboard => {
  const present = parts.filter((part) => part.html !== "" || part.text !== "");
  return {
    html: present.map((part) => part.html).join(""),
    text: present.map((part) => part.text).join(between),
  };
};

const wordsOf = (value: string, footnotes: number): Clipboard =>
  gathered(
    value.split(CARRIED).map((piece, at): Clipboard => {
      if (at % 2 === 0) return { html: escaped(piece), text: piece };
      const number = Number(piece);
      return number >= 1 && number <= footnotes
        ? { html: `<sup>${piece}</sup>`, text: `[${piece}]` }
        : NOTHING;
    }),
    "",
  );

const phrased = <Type extends PhrasingContent["type"]>(
  node: Of<PhrasingContent, Type>,
  footnotes: number,
): Clipboard => PHRASING[node.type](node, footnotes);

const phrasingOf = (nodes: readonly PhrasingContent[], footnotes: number): Clipboard =>
  gathered(
    nodes.map((node) => phrased(node, footnotes)),
    "",
  );

const linkedOf = (url: string, label: Clipboard): Clipboard => {
  const href = url.replaceAll(CARRIED_ANYWHERE, "");
  if (!SAFE_LINK.test(href)) return label;
  return {
    html: `<a href="${escaped(href)}">${label.html}</a>`,
    text: label.text === href ? label.text : `${label.text} (${href})`,
  };
};

type PhrasingReaders = Readers<PhrasingContent>;

const PHRASING: PhrasingReaders = {
  text: (node, footnotes) => wordsOf(node.value, footnotes),
  html: (node, footnotes) => wordsOf(node.value, footnotes),
  inlineCode: (node, footnotes) => around(wordsOf(node.value, footnotes), "code"),
  break: () => ({ html: "<br>", text: "\n" }),
  image: (node, footnotes) => wordsOf(node.alt ?? "", footnotes),
  imageReference: (node, footnotes) => wordsOf(node.alt ?? "", footnotes),
  footnoteReference: () => NOTHING,
  link: (node, footnotes) => linkedOf(node.url, phrasingOf(node.children, footnotes)),
  linkReference: (node, footnotes) => phrasingOf(node.children, footnotes),
  emphasis: (node, footnotes) => around(phrasingOf(node.children, footnotes), "em"),
  strong: (node, footnotes) => around(phrasingOf(node.children, footnotes), "strong"),
  delete: (node, footnotes) => around(phrasingOf(node.children, footnotes), "del"),
};

const FLOW_TYPES: ReadonlySet<string> = new Set([
  "paragraph",
  "heading",
  "code",
  "html",
  "list",
  "blockquote",
  "thematicBreak",
  "table",
  "definition",
  "footnoteDefinition",
]);

const isFlow = (node: RootContent): node is Flow => FLOW_TYPES.has(node.type);

const flowing = <Type extends Flow["type"]>(node: Of<Flow, Type>, footnotes: number): Clipboard =>
  FLOW[node.type](node, footnotes);

const flowOf = (nodes: readonly RootContent[], footnotes: number): Clipboard =>
  gathered(
    nodes.filter(isFlow).map((node) => flowing(node, footnotes)),
    "\n\n",
  );

const itemOf = (node: RootContent, footnotes: number): Clipboard => {
  if (node.type !== "listItem") return NOTHING;
  const spread = node.spread === true;
  const parts = node.children.map((child) =>
    child.type === "paragraph" && !spread
      ? phrasingOf(child.children, footnotes)
      : flowOf([child], footnotes),
  );
  return gathered(parts, spread ? "\n\n" : "\n");
};

type Listing = { readonly ordered: boolean; readonly start: number };

const indented = (text: string): string => text.replaceAll(/\n(?=.)/gu, "\n  ");

const listedOf = ({ ordered, start }: Listing, items: readonly Clipboard[]): Clipboard => {
  const tag = ordered ? "ol" : "ul";
  const opening = ordered && start !== 1 ? `<ol start="${String(start)}">` : `<${tag}>`;
  return {
    html: `${opening}${items.map((item) => `<li>${item.html}</li>`).join("")}</${tag}>`,
    text: items
      .map((item, at) => `${ordered ? `${String(start + at)}.` : "-"} ${indented(item.text)}`)
      .join("\n"),
  };
};

const quotedOf = (inner: Clipboard): Clipboard => ({
  html: `<blockquote>${inner.html}</blockquote>`,
  text: inner.text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n"),
});

const rowOf = (cells: readonly Clipboard[], tag: "th" | "td"): Clipboard => ({
  html: `<tr>${cells.map((cell) => `<${tag}>${cell.html}</${tag}>`).join("")}</tr>`,
  text: cells.map((cell) => cell.text).join(" | "),
});

type FlowReaders = Readers<Flow>;

const FLOW: FlowReaders = {
  paragraph: (node, footnotes) => around(phrasingOf(node.children, footnotes), "p"),
  heading: (node, footnotes) =>
    around(phrasingOf(node.children, footnotes), `h${String(node.depth)}`),
  code: (node, footnotes) => around(around(wordsOf(node.value, footnotes), "code"), "pre"),
  html: (node, footnotes) => around(wordsOf(node.value, footnotes), "p"),
  list: (node, footnotes) =>
    listedOf(
      { ordered: node.ordered === true, start: node.start ?? 1 },
      node.children.map((item) => itemOf(item, footnotes)),
    ),
  blockquote: (node, footnotes) => quotedOf(flowOf(node.children, footnotes)),
  thematicBreak: () => ({ html: "<hr>", text: "---" }),
  table: (node, footnotes) => {
    const rows = node.children.map((row, at) =>
      rowOf(
        row.children.map((cell) => phrasingOf(cell.children, footnotes)),
        at === 0 ? "th" : "td",
      ),
    );
    return {
      html: `<table>${rows.map((row) => row.html).join("")}</table>`,
      text: gathered(rows, "\n").text,
    };
  },
  definition: () => NOTHING,
  footnoteDefinition: () => NOTHING,
};

const sentence = (part: string): string => (/[.!?]$/u.test(part) ? part : `${part}.`);

const sourceWords = (source: CitedSource): string =>
  source.locator === null || quotedPassageOf(source) !== undefined
    ? source.resource
    : `${source.resource}, ${source.locator}`;

export type SourcedEntry = {
  readonly title: string;
  readonly sources: readonly CitedSource[];
  readonly wording: string | null;
};

const namesAConcept = (source: CitedSource): boolean => IRI.test(source.resource);

export const sourceLineOf = (entry: SourcedEntry): string => {
  const cited = entry.sources.filter((source) => !namesAConcept(source));
  const where =
    cited.length === 0 ? "No source recorded" : `Source: ${cited.map(sourceWords).join("; ")}`;
  const wording = entry.wording === null ? [] : [`Wording: ${entry.wording}`];
  return [entry.title, where, ...wording].map(sentence).join(" ");
};

const SOURCES = "Sources";

const sourcesOf = (lines: readonly string[]): Clipboard => ({
  html: `<p><strong>${SOURCES}</strong></p><ol>${lines.map((line) => `<li>${escaped(line)}</li>`).join("")}</ol>`,
  text: `${SOURCES}\n${lines.map((line, at) => `[${String(at + 1)}] ${line}`).join("\n")}`,
});

export const clipboardOf = (markdown: string, lines: readonly string[]): Clipboard => {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  const body = flowOf(tree.children, lines.length);
  return lines.length === 0 ? body : gathered([body, sourcesOf(lines)], "\n\n");
};
