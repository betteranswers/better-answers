import type { BlockContent, DefinitionContent, PhrasingContent, RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { IRI, ULID_CHARACTERS, type CitedSource } from "@better-answers/schema";
import {
  citedMarkdownOf,
  remarkCitations,
  type BodyPart,
} from "@better-answers/schema/cited-markdown";

export type Clipboard = { readonly html: string; readonly text: string };

const NOTHING: Clipboard = { html: "", text: "" };

type Tagged = { readonly type: string };

type Of<Union extends Tagged, Type extends Union["type"]> = Extract<Union, { readonly type: Type }>;

type Readers<Union extends Tagged> = {
  readonly [Type in Union["type"]]: (node: Of<Union, Type>) => Clipboard;
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

const wordsOf = (value: string): Clipboard => ({ html: escaped(value), text: value });

const phrased = <Type extends PhrasingContent["type"]>(
  node: Of<PhrasingContent, Type>,
): Clipboard => PHRASING[node.type](node);

const phrasingOf = (nodes: readonly PhrasingContent[]): Clipboard =>
  gathered(nodes.map(phrased), "");

const linkedOf = (href: string, label: Clipboard): Clipboard => {
  if (!SAFE_LINK.test(href)) return label;
  return {
    html: `<a href="${escaped(href)}">${label.html}</a>`,
    text: label.text === href ? label.text : `${label.text} (${href})`,
  };
};

type PhrasingReaders = Readers<PhrasingContent>;

const PHRASING: PhrasingReaders = {
  text: (node) => wordsOf(node.value),
  html: (node) => wordsOf(node.value),
  inlineCode: (node) => around(wordsOf(node.value), "code"),
  break: () => ({ html: "<br>", text: "\n" }),
  image: (node) => wordsOf(node.alt ?? ""),
  imageReference: (node) => wordsOf(node.alt ?? ""),
  footnoteReference: () => NOTHING,
  citation: (node) => ({
    html: `<sup>${String(node.number)}</sup>`,
    text: `[${String(node.number)}]`,
  }),
  link: (node) => linkedOf(node.url, phrasingOf(node.children)),
  linkReference: (node) => phrasingOf(node.children),
  emphasis: (node) => around(phrasingOf(node.children), "em"),
  strong: (node) => around(phrasingOf(node.children), "strong"),
  delete: (node) => around(phrasingOf(node.children), "del"),
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

const flowing = <Type extends Flow["type"]>(node: Of<Flow, Type>): Clipboard =>
  FLOW[node.type](node);

const flowOf = (nodes: readonly RootContent[]): Clipboard =>
  gathered(nodes.filter(isFlow).map(flowing), "\n\n");

const itemOf = (node: RootContent): Clipboard => {
  if (node.type !== "listItem") return NOTHING;
  const spread = node.spread === true;
  const parts = node.children.map((child) =>
    child.type === "paragraph" && !spread ? phrasingOf(child.children) : flowOf([child]),
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
  paragraph: (node) => around(phrasingOf(node.children), "p"),
  heading: (node) => around(phrasingOf(node.children), `h${String(node.depth)}`),
  code: (node) => around(around(wordsOf(node.value), "code"), "pre"),
  html: (node) => around(wordsOf(node.value), "p"),
  list: (node) =>
    listedOf({ ordered: node.ordered === true, start: node.start ?? 1 }, node.children.map(itemOf)),
  blockquote: (node) => quotedOf(flowOf(node.children)),
  thematicBreak: () => ({ html: "<hr>", text: "---" }),
  table: (node) => {
    const rows = node.children.map((row, at) =>
      rowOf(
        row.children.map((cell) => phrasingOf(cell.children)),
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

/** The read path's test: a locator naming a document, well formed or not, may name one the reader cannot read. */
const NAMES_A_DOCUMENT = new RegExp(ULID_CHARACTERS, "iu");

const sourceWords = (source: CitedSource): string =>
  source.locator === null || NAMES_A_DOCUMENT.test(source.locator)
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

export const clipboardOf = (parts: readonly BodyPart[], lines: readonly string[]): Clipboard => {
  const { markdown, citations } = citedMarkdownOf(parts);
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkCitations, citations);
  const body = flowOf(processor.runSync(processor.parse(markdown)).children);
  return lines.length === 0 ? body : gathered([body, sourcesOf(lines)], "\n\n");
};
