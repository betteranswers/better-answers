import {
  ListBulletsIcon,
  ListNumbersIcon,
  QuotesIcon,
  TextBIcon,
  TextHTwoIcon,
  TextItalicIcon,
  type Icon as PhosphorGlyph,
} from "@phosphor-icons/react";
import type { ChainedCommands, Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";

import { Button } from "@/shared/ui/button.tsx";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/shared/ui/tooltip.tsx";

import { FORMATTING_WORDS as WORDS } from "./editor-words.ts";

const HOVER_DELAY_MS = 200;

type Control = {
  readonly name: string;
  readonly glyph: PhosphorGlyph;
  readonly active: string;
  readonly apply: (chain: ChainedCommands) => ChainedCommands;
};

const CONTROLS: readonly Control[] = [
  { name: WORDS.bold, glyph: TextBIcon, active: "bold", apply: (chain) => chain.toggleBold() },
  {
    name: WORDS.italic,
    glyph: TextItalicIcon,
    active: "italic",
    apply: (chain) => chain.toggleItalic(),
  },
  {
    name: WORDS.heading,
    glyph: TextHTwoIcon,
    active: "heading",
    apply: (chain) => chain.toggleHeading({ level: 2 }),
  },
  {
    name: WORDS.bulletedList,
    glyph: ListBulletsIcon,
    active: "bulletList",
    apply: (chain) => chain.toggleBulletList(),
  },
  {
    name: WORDS.numberedList,
    glyph: ListNumbersIcon,
    active: "orderedList",
    apply: (chain) => chain.toggleOrderedList(),
  },
  {
    name: WORDS.quote,
    glyph: QuotesIcon,
    active: "blockquote",
    apply: (chain) => chain.toggleBlockquote(),
  },
];

export function FormattingToolbar(properties: { readonly editor: Editor }) {
  const { editor } = properties;
  const pressed = useEditorState({
    editor,
    selector: ({ editor: current }) => CONTROLS.map((control) => current.isActive(control.active)),
  });

  return (
    <TooltipProvider delayDuration={HOVER_DELAY_MS}>
      <div role="toolbar" aria-label={WORDS.toolbar} className="flex flex-wrap gap-1">
        {CONTROLS.map((control, index) => {
          const on = pressed[index] ?? false;
          return (
            <Tooltip key={control.name}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label={control.name}
                  aria-pressed={on}
                  className="aria-pressed:border-[var(--border-strong)] aria-pressed:bg-accent"
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={() => {
                    control.apply(editor.chain().focus()).run();
                  }}
                >
                  <control.glyph aria-hidden weight={on ? "bold" : "regular"} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{control.name}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
