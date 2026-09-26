import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { refusalOf, type ApiError, type Refusal } from "@/shared/api/trpc.ts";
import { RefusalLine } from "@/shared/refusal-outcome.tsx";
import { NO_RESPONSE, SAID_OF_CLASS, type Said } from "@/shared/refusal-words.ts";
import { Button } from "@/shared/ui/button.tsx";

import { leavingFor, pageQuery } from "./carried-flow.ts";

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

function SignInAgain(properties: { readonly signInAt: string }) {
  const navigate = useNavigate();
  return (
    <Button
      type="button"
      variant="link"
      className="mt-4 px-0"
      onClick={() => {
        void navigate(leavingFor(properties.signInAt));
      }}
    >
      Sign in again
    </Button>
  );
}

/** Every unauthenticated word says the one thing, since signing in again is its one remedy. */
const saidOfFailure = (
  refusal: Refusal | undefined,
  saidOf: (refusal: Refusal) => Said,
  unanswered: Said,
): Said => {
  if (refusal === undefined) return unanswered;
  return refusal.class === "unauthenticated" ? SAID_OF_CLASS.unauthenticated : saidOf(refusal);
};

/**
 * What went wrong and what to do, in the shared refusal template. A wordless failure says
 * `unanswered`, and an ended session signs in at `signInAt`.
 */
export function Refused(properties: {
  readonly id: string;
  readonly failure: Error | ApiError;
  readonly saidOf: (refusal: Refusal) => Said;
  readonly unanswered?: Said;
  readonly signInAt?: string;
}) {
  const refusal = refusalOf(properties.failure);
  const sessionEnded = refusal?.class === "unauthenticated";
  const said = saidOfFailure(refusal, properties.saidOf, properties.unanswered ?? NO_RESPONSE);
  return (
    <>
      <Outcome tone="refused" id={properties.id}>
        <RefusalLine said={said} />
      </Outcome>
      {sessionEnded ? (
        <SignInAgain signInAt={properties.signInAt ?? `/sign-in${pageQuery()}`} />
      ) : null}
    </>
  );
}
