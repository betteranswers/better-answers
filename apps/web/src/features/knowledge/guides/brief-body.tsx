import type { Editor } from "@tiptap/core";
import { useEffect, useId, useState, type MouseEvent } from "react";

import { Button } from "@/shared/ui/button.tsx";

// oxlint-disable-next-line no-restricted-imports -- the Brief editor is the concept editor's visual body with footnote chips
import { VisualBody } from "../editing/visual-body.tsx";
import type { Include } from "./brief-editing.ts";
import { briefExtensions, FOOTNOTE_NODE } from "./brief-footnote.ts";
import { BRIEF_WORDS as WORDS } from "./guide-words.ts";

export type BriefBodyProps = {
  readonly label: string;
  readonly value: string;
  readonly includes: readonly Include[];
  readonly placed: ReadonlySet<string>;
  readonly onChange: (markdown: string) => void;
};

const titlesOf = (includes: readonly Include[]): Map<string, string> =>
  new Map(includes.map((include) => [include.label, include.title]));

const keepsTheCaret = (event: MouseEvent): void => {
  event.preventDefault();
};

function FootnotePlacer(properties: {
  readonly editor: Editor;
  readonly includes: readonly Include[];
  readonly placed: ReadonlySet<string>;
}) {
  const { editor, includes, placed } = properties;
  const labelId = useId();
  if (includes.length === 0) return null;
  return (
    <fieldset
      aria-labelledby={labelId}
      className="m-0 flex min-w-0 flex-wrap items-center gap-1 border-0 p-0"
    >
      <span id={labelId} className="mr-1 text-muted-foreground">
        {WORDS.placing}
      </span>
      {includes.map((include) => (
        <Button
          key={include.label}
          type="button"
          variant="outline"
          size="sm"
          className="h-auto min-h-8 whitespace-normal"
          onMouseDown={keepsTheCaret}
          onClick={() => {
            editor
              .chain()
              .focus()
              .insertContent({ type: FOOTNOTE_NODE, attrs: { label: include.label } })
              .run();
          }}
        >
          {include.title}{" "}
          {placed.has(include.label) ? null : (
            <span className="font-normal text-muted-foreground">({WORDS.notPlaced})</span>
          )}
        </Button>
      ))}
    </fieldset>
  );
}

export function BriefBody(properties: BriefBodyProps) {
  const { includes, placed } = properties;
  const [titles] = useState(() => titlesOf(includes));
  useEffect(() => {
    for (const include of includes) titles.set(include.label, include.title);
  }, [includes, titles]);
  const [extensions] = useState(() =>
    briefExtensions((footnote) => titles.get(footnote) ?? footnote),
  );

  return (
    <VisualBody
      label={properties.label}
      value={properties.value}
      onChange={properties.onChange}
      extensions={extensions}
      autofocus
      beside={(editor) => <FootnotePlacer editor={editor} includes={includes} placed={placed} />}
    />
  );
}
