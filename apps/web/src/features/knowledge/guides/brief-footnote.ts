import { mergeAttributes, type Editor, type Extensions } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

// oxlint-disable-next-line no-restricted-imports -- the Brief editor reuses the concept editor's footnote atom
import { FootnoteReference, MARKDOWN_EXTENSIONS } from "../editing/markdown-round-trip.ts";
import { BRIEF_WORDS as WORDS } from "./guide-words.ts";

export const FOOTNOTE_NODE = FootnoteReference.name;

const CHIP =
  "mx-0.5 inline-block min-h-6 border border-border bg-muted px-1.5 align-baseline font-sans! [font-size:var(--text-sm)]! leading-6!";

type Direction = 1 | -1;

type Titled = (label: string) => string;

const labelOf = (attributes: { readonly label?: unknown }): string =>
  typeof attributes.label === "string" ? attributes.label : "";

const stepsOverAChip = (editor: Editor, direction: Direction): boolean => {
  const { selection } = editor.state;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;
  const beside = direction === 1 ? selection.$head.nodeAfter : selection.$head.nodeBefore;
  if (beside?.type.name !== FOOTNOTE_NODE) return false;
  return editor.commands.setTextSelection(selection.head + direction * beside.nodeSize);
};

const titledFootnote = (titleOf: Titled) =>
  FootnoteReference.extend({
    renderHTML({ node, HTMLAttributes }) {
      const label = labelOf(node.attrs);
      return [
        "sup",
        mergeAttributes(HTMLAttributes, { "data-footnote-reference": label, class: CHIP }),
        ["span", { class: "sr-only" }, WORDS.footnote],
        titleOf(label),
      ];
    },

    addKeyboardShortcuts() {
      return {
        ArrowRight: () => stepsOverAChip(this.editor, 1),
        ArrowLeft: () => stepsOverAChip(this.editor, -1),
      };
    },
  });

export const briefExtensions = (titleOf: Titled): Extensions => [
  ...MARKDOWN_EXTENSIONS.filter((extension) => extension.name !== FOOTNOTE_NODE),
  titledFootnote(titleOf),
];
