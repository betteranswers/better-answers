/**
 * The app's Outcome pattern, reproduced locally for these blocks.
 *
 * Registry items needed beyond the installed set: none.
 *
 * Every outcome is announced inline beside the control that caused it — a `role="status"`
 * for an expected result, a `role="alert"` for a refusal — because the app has no toasts and
 * a screen reader must hear the answer without hunting for it.
 */
import type { ReactNode } from "react";

import type { OutcomeTone } from "@/features/workspace/types.ts";

export type OutcomeProps = {
  readonly tone: OutcomeTone;
  readonly children: ReactNode;
};

export function Outcome({ tone, children }: OutcomeProps) {
  return (
    <p
      role={tone === "refused" ? "alert" : "status"}
      className={
        tone === "refused"
          ? "mt-4 border-l-2 border-destructive pl-3 text-destructive"
          : "mt-4 text-muted-foreground"
      }
    >
      {children}
    </p>
  );
}
