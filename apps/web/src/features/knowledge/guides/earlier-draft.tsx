import { replaceMarkers } from "@better-answers/schema/brief-marker";

import { Button } from "@/shared/ui/button.tsx";
import { Textarea } from "@/shared/ui/textarea.tsx";

import type { Include } from "./brief-editing.ts";
import { BRIEF_WORDS as WORDS } from "./guide-words.ts";

const readableDraft = (markdown: string, includes: readonly Include[]): string => {
  const titles = new Map(includes.map((include) => [include.label, include.title]));
  return replaceMarkers(markdown, (label) => `[${WORDS.footnote}${titles.get(label) ?? label}]`);
};

export function EarlierDraft(properties: {
  readonly markdown: string;
  readonly includes: readonly Include[];
  readonly onDiscard: () => void;
}) {
  return (
    <section aria-label={WORDS.earlier} className="mt-6 border-t border-border pt-4">
      <p className="font-semibold">{WORDS.earlier}</p>
      <p className="mt-1 text-muted-foreground">{WORDS.earlierDetail}</p>
      <Textarea
        readOnly
        aria-label={WORDS.earlier}
        value={readableDraft(properties.markdown, properties.includes)}
        className="mt-2"
        onFocus={(event) => {
          event.currentTarget.select();
        }}
      />
      <Button type="button" variant="outline" className="mt-3" onClick={properties.onDiscard}>
        {WORDS.discardEarlier}
      </Button>
    </section>
  );
}
