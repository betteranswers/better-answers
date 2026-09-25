import type { ReactNode } from "react";

import { refusalOf, type ApiError, type Refusal } from "@/shared/api/trpc.ts";

export function AuthScreen(properties: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="px-4 py-5 md:px-8">
        <p className="font-mono font-medium tracking-tight text-foreground">better-answers</p>
      </header>

      <main id="screen" className="flex-1 px-4 md:px-8">
        <div className="max-w-prose">
          <h1 className="text-xl font-medium">{properties.title}</h1>
          {properties.children}
        </div>
      </main>
    </div>
  );
}

export function Outcome(properties: {
  readonly tone: "said" | "refused";
  readonly children: ReactNode;
  readonly id?: string;
}) {
  return (
    <p
      id={properties.id}
      role={properties.tone === "refused" ? "alert" : "status"}
      className={
        properties.tone === "refused"
          ? "mt-4 border-l-2 border-destructive pl-3 text-destructive"
          : "mt-4 text-muted-foreground"
      }
    >
      {properties.children}
    </p>
  );
}

export type Said = { readonly why: string; readonly next: string };

export const SESSION_ENDED: Said = { why: "Your session has ended.", next: "Sign in again." };

/**
 * A refusal shown as its own word, then why and what the reader can do next; a failure with no
 * word says `unanswered` instead.
 */
export function Refused(properties: {
  readonly id: string;
  readonly failure: Error | ApiError;
  readonly saidOf: (refusal: Refusal) => Said;
  readonly unanswered: string;
}) {
  const refusal = refusalOf(properties.failure);
  if (refusal === undefined) {
    return (
      <Outcome tone="refused" id={properties.id}>
        {properties.unanswered}
      </Outcome>
    );
  }
  const said = properties.saidOf(refusal);
  return (
    <Outcome tone="refused" id={properties.id}>
      Refused: <code className="font-mono">{refusal.word}</code>. {said.why} {said.next}
    </Outcome>
  );
}
