import { mergeAttributes, Editor, Node, type Extensions } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";

import type { Mode } from "./concept-editing.ts";

const FOOTNOTE_REFERENCE = /^\[\^([\w-]+)\](?!:)/u;

const labelOf = (attributes: { readonly label?: unknown } | undefined): string =>
  typeof attributes?.label === "string" ? attributes.label : "";

export const FootnoteReference = Node.create({
  name: "footnoteReference",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      label: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-footnote-reference") ?? "",
      },
    };
  },

  parseHTML() {
    return [{ tag: "sup[data-footnote-reference]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "sup",
      mergeAttributes(HTMLAttributes, { "data-footnote-reference": labelOf(node.attrs) }),
      labelOf(node.attrs),
    ];
  },

  markdownTokenizer: {
    name: "footnoteReference",
    level: "inline",
    start: (source) => source.indexOf("[^"),
    tokenize: (source) => {
      const found = FOOTNOTE_REFERENCE.exec(source);
      if (found === null) return undefined;
      return { type: "footnoteReference", raw: found[0], text: found[1] ?? "" };
    },
  },

  parseMarkdown: (token, helpers) =>
    helpers.createNode("footnoteReference", { label: token.text ?? "" }),

  renderMarkdown: (node) => `[^${labelOf(node.attrs)}]`,
});

export const MARKDOWN_EXTENSIONS: Extensions = [
  StarterKit.configure({ underline: false, link: { openOnClick: false } }),
  Markdown,
  FootnoteReference,
];

const TRAILING_BREAKS = /\n+$/u;

const trimmed = (text: string): string => text.replace(TRAILING_BREAKS, "");

export const endingOf = (text: string): string => TRAILING_BREAKS.exec(text)?.[0] ?? "";

const CODE = /(?<!\\)(```[\s\S]*?```|`[^`\n]*`)/u;

const PLAIN_ENTITIES: readonly (readonly [RegExp, string])[] = [
  [/&amp;(?![#\w]+;)/gu, "&"],
  [/&lt;(?![A-Za-z/!?])/gu, "<"],
  [/(?<=[\p{L}\p{N}]\s)&gt;/gu, ">"],
];

const spelledPlainly = (prose: string): string =>
  PLAIN_ENTITIES.reduce((text, [entity, plain]) => text.replace(entity, plain), prose);

export const markdownOf = (editor: Editor): string =>
  trimmed(
    editor
      .getMarkdown()
      .split(CODE)
      .map((part, at) => (at % 2 === 0 ? spelledPlainly(part) : part))
      .join(""),
  );

export const losesMarkdown = (body: string): boolean => {
  const editor = new Editor({
    element: null,
    extensions: MARKDOWN_EXTENSIONS,
    content: body,
    contentType: "markdown",
  });
  try {
    return markdownOf(editor) !== trimmed(body);
  } finally {
    editor.destroy();
  }
};

export const openingMode = (body: string): Mode => (losesMarkdown(body) ? "source" : "visual");
