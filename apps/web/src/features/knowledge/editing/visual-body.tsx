import type { Editor, Extensions } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { useMemo, useState, type ReactNode } from "react";

import { cn } from "@/shared/lib/utils.ts";

import { FormattingToolbar } from "./formatting-toolbar.tsx";
import { endingOf, MARKDOWN_EXTENSIONS, markdownOf } from "./markdown-round-trip.ts";

export type BodyField = {
  readonly label: string;
  readonly value: string;
  readonly onChange: (markdown: string) => void;
  readonly describedBy?: string | undefined;
};

export type VisualOptions = {
  readonly extensions?: Extensions | undefined;
  readonly autofocus?: boolean | undefined;
  readonly beside?: ((editor: Editor) => ReactNode) | undefined;
};

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

export function VisualBody(properties: BodyField & VisualOptions) {
  const { label, describedBy, onChange, beside } = properties;
  const [initial] = useState(properties.value);
  const ending = endingOf(initial);
  const editorProps = useMemo(
    () => ({ attributes: attributesOf(label, describedBy) }),
    [label, describedBy],
  );

  const editor = useEditor({
    extensions: properties.extensions ?? MARKDOWN_EXTENSIONS,
    content: initial,
    contentType: "markdown",
    editorProps,
    autofocus: properties.autofocus === true ? "end" : false,
    onUpdate: ({ editor: updated }) => {
      onChange(markdownOf(updated) + ending);
    },
  });

  return (
    <div className="space-y-2">
      <FormattingToolbar editor={editor} />
      {beside?.(editor)}
      <EditorContent editor={editor} className={FIELD} />
    </div>
  );
}
