import type { ReactNode } from "react";

export type Outcome =
  | { readonly tone: "said"; readonly words: ReactNode }
  | { readonly tone: "refused"; readonly words: ReactNode };

export const selectFirst = (line: string): Outcome => ({ tone: "said", words: line });

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
