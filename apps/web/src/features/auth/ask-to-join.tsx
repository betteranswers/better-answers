import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { flushSync } from "react-dom";

import {
  ceilingLiftsIn,
  refusalOf,
  useTRPC,
  type ApiError,
  type Refusal,
} from "@/shared/api/trpc.ts";
import { useKeystroke, type Keystroke } from "@/shared/keystrokes.tsx";
import type { Said } from "@/shared/refusal-words.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Input } from "@/shared/ui/input.tsx";
import { Label } from "@/shared/ui/label.tsx";

import { Refused } from "./auth-screen.tsx";
import { ASK_REFUSED, ASK_UNANSWERED, REASON_REFUSED } from "./refusal-words.ts";

export const ASK_TO_JOIN: Keystroke = { key: "j", act: "Ask to join a workspace" };

/**
 * The api's rule holds the limit. Stated rather than imported, because the schema module holding
 * it would bring its table definitions into the bundle.
 */
const REASON_MAX_CHARACTERS = 1_000;

const HEADING = "ask-to-join-heading";

const HINT = "ask-to-join-hint";

const SLUG_FIELD = "ask-to-join-slug";

const REASON_FIELD = "ask-to-join-reason";

const REASON_HINT = "ask-to-join-reason-hint";

const REFUSED = "ask-to-join-refused";

const ASKED = "ask-to-join-asked";

const ASKED_TITLE = "ask-to-join-asked-title";

/** One sentence for every slug, so the answer cannot tell a customer from a stranger. */
const ACKNOWLEDGED =
  "If a workspace goes by that slug, its Admins will see that you asked and why. If one approves, an invitation comes to your email address; nothing is sent otherwise.";

const saidOf = (refusal: Refusal): Said =>
  refusal.class === "malformed" ? REASON_REFUSED : ASK_REFUSED;

const minutesUntil = (seconds: number): string => {
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? "a minute" : `${minutes} minutes`;
};

const unansweredOf = (failure: Error | ApiError): Said => {
  const liftsIn = ceilingLiftsIn(failure);
  return liftsIn === undefined
    ? ASK_UNANSWERED
    : {
        why: "You have asked to join too often.",
        next: `Ask again in ${minutesUntil(liftsIn)}.`,
      };
};

/** Focus is moved here once the ask lands, so the answer is what a reader meets next. */
function Asked() {
  return (
    <div
      id={ASKED}
      role="alert"
      aria-labelledby={ASKED_TITLE}
      tabIndex={-1}
      className="mt-4 border border-border p-3"
    >
      <p id={ASKED_TITLE} className="font-medium text-foreground">
        Asked
      </p>
      <p className="mt-1 text-muted-foreground">{ACKNOWLEDGED}</p>
    </div>
  );
}

function AskOutcome(properties: {
  readonly asked: boolean;
  readonly failure: Error | ApiError | null;
}) {
  if (properties.asked) return <Asked />;
  if (properties.failure === null) return null;
  return (
    <Refused
      id={REFUSED}
      failure={properties.failure}
      saidOf={saidOf}
      unanswered={unansweredOf(properties.failure)}
    />
  );
}

const focusOn = (id: string) => {
  document.getElementById(id)?.focus();
};

export function AskToJoin() {
  const api = useTRPC();
  const requestAccess = useMutation(api.person.requestAccess.mutationOptions());
  const [slug, setSlug] = useState("");
  const [reason, setReason] = useState("");
  const [asked, setAsked] = useState(false);

  useKeystroke(ASK_TO_JOIN, () => {
    focusOn(SLUG_FIELD);
  });

  const failure = requestAccess.error;
  const refusedAs = failure === null ? undefined : refusalOf(failure)?.class;

  const ask = (event: FormEvent) => {
    event.preventDefault();
    // The button stays enabled while asking, so the focus a click gave it is not dropped.
    if (requestAccess.isPending) return;
    setAsked(false);
    requestAccess.mutate(
      { slug, reason },
      {
        onSuccess: () => {
          flushSync(() => {
            setSlug("");
            setReason("");
            setAsked(true);
          });
          focusOn(ASKED);
        },
        onError: (refused) => {
          if (refusalOf(refused)?.class === "malformed") focusOn(REASON_FIELD);
        },
      },
    );
  };

  return (
    <section aria-labelledby={HEADING} className="mt-8">
      <h2 id={HEADING}>Ask to join a workspace</h2>
      <p id={HINT} className="mt-1 text-muted-foreground">
        Name the workspace by its slug, the short name it goes by, such as{" "}
        <code className="font-mono">acme-joinery</code>. An Admin there can tell you it, and its
        Admins decide.
      </p>

      <form onSubmit={ask} className="mt-4">
        <Label htmlFor={SLUG_FIELD}>Workspace slug</Label>
        <Input
          id={SLUG_FIELD}
          name="slug"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          required
          aria-keyshortcuts={ASK_TO_JOIN.key}
          aria-describedby={HINT}
          className="mt-2 font-mono"
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
        />

        <Label htmlFor={REASON_FIELD} className="mt-4">
          Why you are asking
        </Label>
        <p id={REASON_HINT} className="mt-1 text-muted-foreground">
          One or two sentences the Admins read when they decide. Up to{" "}
          {REASON_MAX_CHARACTERS.toLocaleString("en-GB")} characters.
        </p>
        <Input
          id={REASON_FIELD}
          name="reason"
          required
          maxLength={REASON_MAX_CHARACTERS}
          aria-describedby={failure === null ? REASON_HINT : `${REASON_HINT} ${REFUSED}`}
          aria-invalid={refusedAs === "malformed"}
          className="mt-2"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />

        <Button
          type="submit"
          className="mt-4 aria-disabled:opacity-50"
          aria-disabled={requestAccess.isPending}
        >
          {requestAccess.isPending ? "Asking" : "Ask to join"}
        </Button>
      </form>

      <AskOutcome asked={asked} failure={failure} />
    </section>
  );
}
