import * as React from "react";

/**
 * The unit a reader checks: the concept, the source and locator it rests on, and — one
 * disclosure later — the cited passage (ADR 0015, CONTEXT.md "citation").
 * @startingPoint section="Knowledge" subtitle="Citations and coverage" viewport="700x300"
 */
export interface CitationProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Footnote label from the include — "1", "a". */
  marker?: React.ReactNode;
  concept: React.ReactNode;
  source?: React.ReactNode;
  /** Page, span or section within the source. */
  locator?: React.ReactNode;
  /** Revealed on click; rendered as a quotation, never asserted as the answer. */
  passage?: React.ReactNode;
  /** A `<TrustTag />` for the cited concept. */
  trust?: React.ReactNode;
  defaultOpen?: boolean;
}
export function Citation(props: CitationProps): JSX.Element;
