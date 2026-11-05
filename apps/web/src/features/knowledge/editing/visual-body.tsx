import type { ChainedCommands } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { useMemo, useState } from "react";

import { cn } from "@/shared/lib/utils.ts";
import { Button } from "@/shared/ui/button.tsx";

import { MARKDOWN_EXTENSIONS, markdownOf } from "./markdown-round-trip.ts";

export type BodyField = {
  readonly label: string;
  readonly value: string;
  readonly onChange: (markdown: string) => void;
  readonly describedBy?: string;
};

type Control = {
  readonly name: string;
  readonly active: string;
  readonly apply: (chain: ChainedCommands) => ChainedCommands;
};

const CONTROLS: readonly Control[] = [
  { name: "Bold", active: "bold", apply: (chain) => chain.toggleBold() },
  { name: "Italic", active: "italic", apply: (chain) => chain.toggleItalic() },
  { name: "Heading", active: "heading", apply: (chain) => chain.toggleHeading({ level: 2 }) },
  { name: "Bulleted list", active: "bulletList", apply: (chain) => chain.toggleBulletList() },
  { name: "Numbered list", active: "orderedList", apply: (chain) => chain.toggleOrderedList() },
  { name: "Quote", active: "blockquote", apply: (chain) => chain.toggleBlockquote() },
];

const FORMATTING = "Formatting";

const FIELD = cn(
  "border border-input bg-background",
  "focus-within:[box-shadow:var(--focus-ring)]",
);

const PROSE = cn(
  "min-h-48 px-3 py-2 outline-none wrap-anywhere",
  "[font-size:var(--prose-size,var(--text-lg))] [line-height:var(--prose-leading,var(--leading-prose))]",
  "[&>*+*]:mt-4 [&_li>*+*]:mt-2 [&_li+li]:mt-1",
  "[&_:is(h1,h2,h3)]:font-semibold [&_h1]:text-[length:var(--text-2xl)] [&_h2]:text-[length:var(--text-xl)] [&_h3]:text-[length:var(--text-lg)]",
  "[&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6",
  "[&_blockquote]:border-l [&_blockquote]:border-border [&_blockquote]:pl-4",
  "[&_code]:font-mono [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:whitespace-pre-wrap",
  "[&_hr]:border-border",
  "[&_sup]:mx-0.5 [&_sup]:border [&_sup]:border-border [&_sup]:px-1 [&_sup]:font-mono [&_sup]:text-[length:var(--text-xs)] [&_sup]:leading-none",
);

const attributesOf = (label: string, describedBy: string | undefined) => {
  const attributes = { class: PROSE, "aria-multiline": "true", "aria-label": label };
  return describedBy === undefined
    ? attributes
    : { ...attributes, "aria-describedby": describedBy };
};

export function VisualBody(properties: BodyField) {
  const { label, describedBy, onChange } = properties;
  const [initial] = useState(properties.value);
  const editorProps = useMemo(
    () => ({ attributes: attributesOf(label, describedBy) }),
    [label, describedBy],
  );

  const editor = useEditor({
    extensions: MARKDOWN_EXTENSIONS,
    content: initial,
    contentType: "markdown",
    editorProps,
    onUpdate: ({ editor: updated }) => {
      onChange(markdownOf(updated));
    },
  });

  const pressed = useEditorState({
    editor,
    selector: ({ editor: current }) => CONTROLS.map((control) => current.isActive(control.active)),
  });

  return (
    <div className="space-y-2">
      <div role="toolbar" aria-label={FORMATTING} className="flex flex-wrap gap-1">
        {CONTROLS.map((control, index) => (
          <Button
            key={control.name}
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={pressed[index] ?? false}
            className="aria-pressed:border-[var(--border-strong)] aria-pressed:bg-accent aria-pressed:font-semibold"
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              control.apply(editor.chain().focus()).run();
            }}
          >
            {control.name}
          </Button>
        ))}
      </div>
      <EditorContent editor={editor} className={FIELD} />
    </div>
  );
}
