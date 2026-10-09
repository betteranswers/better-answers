import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { refusalOf, type ApiError, type Refusal } from "@/shared/api/trpc.ts";
import { GridPattern } from "@/shared/blueprint.tsx";
import { useKeystroke, type Keystroke } from "@/shared/keystrokes.tsx";
import { cn } from "@/shared/lib/utils.ts";
import { Logo } from "@/shared/logo.tsx";
import { RefusalLine } from "@/shared/refusal-outcome.tsx";
import { NO_RESPONSE, SAID_OF_CLASS, SIGN_IN_AGAIN, type Said } from "@/shared/refusal-words.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card.tsx";
import { PRODUCT_NAME } from "@/shared/words.ts";

import { leavingFor, pageQuery } from "./carried-flow.ts";

export const focusOn = (id: string) => {
  document.getElementById(id)?.focus();
};

/** The card's marks stand for its primary button's. With no title, the children's first heading is the `h1`. */
export function AuthPage(properties: { readonly title?: string; readonly children: ReactNode }) {
  return (
    <GridPattern>
      <div className="flex min-h-screen flex-col bg-background">
        <header className="px-4 py-5 md:px-8">
          <p className="flex items-center gap-2 font-mono text-lg font-medium tracking-tight text-foreground">
            <Logo />
            {PRODUCT_NAME}
          </p>
        </header>

        <main id="page" className="flex-1 px-4 pb-16 md:px-8">
          <Card marks className="mx-auto mt-4 w-full max-w-measure md:mt-16">
            {properties.title === undefined ? null : (
              <CardHeader>
                <CardTitle asChild className="text-xl font-medium">
                  <h1>{properties.title}</h1>
                </CardTitle>
              </CardHeader>
            )}
            <CardContent>{properties.children}</CardContent>
          </Card>
        </main>
      </div>
    </GridPattern>
  );
}

/**
 * A polite region shown already holding its words may go unread, so a status stays in the tree
 * while empty. Alerts are read when shown.
 */
export function Outcome(properties: {
  readonly tone: "said" | "refused";
  readonly children: ReactNode;
  readonly id?: string;
}) {
  return (
    <p
      id={properties.id}
      role={properties.tone === "refused" ? "alert" : "status"}
      className={cn(
        "mt-4",
        properties.tone === "refused"
          ? "text-destructive empty:hidden"
          : "text-muted-foreground empty:sr-only",
      )}
    >
      {properties.children}
    </p>
  );
}

export function ReadAgain(properties: {
  readonly keystroke: Keystroke;
  readonly reading: boolean;
  readonly words: { readonly tryAgain: string; readonly readingAgain: string };
  readonly onReadAgain: () => void;
  readonly className?: string;
}) {
  const readAgain = () => {
    // Enabled while reading, so the focus a click gave the button is not dropped.
    if (!properties.reading) properties.onReadAgain();
  };
  useKeystroke(properties.keystroke, readAgain);

  return (
    <Button
      type="button"
      variant="outline"
      className={cn("aria-disabled:opacity-50", properties.className)}
      aria-disabled={properties.reading}
      aria-keyshortcuts={properties.keystroke.key}
      onClick={readAgain}
    >
      {properties.reading ? properties.words.readingAgain : properties.words.tryAgain}
    </Button>
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
      {SIGN_IN_AGAIN}
    </Button>
  );
}

/** An ended session is said by its `why` alone: the button after it is the remedy. */
function FailureLine(properties: {
  readonly refusal: Refusal | undefined;
  readonly saidOf: (refusal: Refusal) => Said;
  readonly unanswered: Said;
}) {
  const { refusal } = properties;
  if (refusal === undefined) return <RefusalLine said={properties.unanswered} />;
  if (refusal.class === "unauthenticated") return <>{SAID_OF_CLASS.unauthenticated.why}</>;
  return <RefusalLine said={properties.saidOf(refusal)} />;
}

/**
 * What went wrong and what to do. A wordless failure says `unanswered`; an ended session gets a
 * button that signs in at `signInAt`.
 */
export function Refused(properties: {
  readonly id: string;
  readonly failure: Error | ApiError | null;
  readonly saidOf: (refusal: Refusal) => Said;
  readonly unanswered?: Said;
  readonly signInAt?: string;
}) {
  const { failure } = properties;
  const refusal = failure === null ? undefined : refusalOf(failure);
  const sessionEnded = refusal?.class === "unauthenticated";
  const unanswered = properties.unanswered ?? NO_RESPONSE;
  return (
    <>
      <Outcome tone="refused" id={properties.id}>
        {failure === null ? null : (
          <FailureLine refusal={refusal} saidOf={properties.saidOf} unanswered={unanswered} />
        )}
      </Outcome>
      {sessionEnded ? (
        <SignInAgain signInAt={properties.signInAt ?? `/sign-in${pageQuery()}`} />
      ) : null}
    </>
  );
}
