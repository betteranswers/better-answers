import type { ReactNode } from "react";

export type Outcome =
  | { readonly tone: "said"; readonly words: ReactNode }
  | { readonly tone: "refused"; readonly words: ReactNode };

/** Said when a row's keystroke is pressed and no row has held focus; the line names the row. */
export const selectFirst = (line: string): Outcome => ({ tone: "said", words: line });

/**
 * A polite region shown already holding its words may go unread, so the status stays in the tree
 * while empty. Alerts are read when shown.
 */
export function OutcomeLine(properties: {
  readonly outcome: Outcome | undefined;
  readonly className?: string;
}) {
  const { outcome } = properties;

  return (
    <div className={properties.className}>
      <output className="block text-muted-foreground empty:sr-only">
        {outcome?.tone === "said" ? outcome.words : null}
      </output>
      {/* Not a paragraph: a refusal that names several items holds their list. */}
      <div role="alert" className="text-foreground empty:hidden">
        {outcome?.tone === "refused" ? outcome.words : null}
      </div>
    </div>
  );
}
