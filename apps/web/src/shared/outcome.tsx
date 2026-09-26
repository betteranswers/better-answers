import type { ReactNode } from "react";

import { SELECT_FIRST } from "@/shared/keystroke-words.ts";

export type Outcome =
  | { readonly tone: "said"; readonly words: ReactNode }
  | { readonly tone: "refused"; readonly words: ReactNode };

export const selectFirst = (row: keyof typeof SELECT_FIRST): Outcome => ({
  tone: "said",
  words: SELECT_FIRST[row],
});

/**
 * Both regions stand from the first render, because a live region inserted with its words already
 * inside is one a screen reader may never read.
 */
export function OutcomeLine(properties: {
  readonly outcome: Outcome | undefined;
  readonly className?: string;
}) {
  const { outcome } = properties;

  return (
    <div className={properties.className}>
      <output className="block text-muted-foreground empty:hidden">
        {outcome?.tone === "said" ? outcome.words : null}
      </output>
      <p role="alert" className="text-foreground empty:hidden">
        {outcome?.tone === "refused" ? outcome.words : null}
      </p>
    </div>
  );
}
