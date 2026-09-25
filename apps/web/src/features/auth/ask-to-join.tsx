import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { flushSync } from "react-dom";

import { isThrottled, refusalOf, useTRPC, type ApiError, type Refusal } from "@/shared/api/trpc.ts";
import { useKeystroke, type Keystroke } from "@/shared/keystrokes.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Input } from "@/shared/ui/input.tsx";
import { Label } from "@/shared/ui/label.tsx";

import { Refused, SESSION_ENDED, type Said } from "./auth-screen.tsx";
import { leavingFor, pageQuery } from "./carried-flow.ts";

export const ASK_TO_JOIN: Keystroke = { key: "j", act: "Ask to join a workspace" };

/**
 * The api's rule holds the limit; this is the number the screen tells a person before they type.
 */
const REASON_MAX_CHARACTERS = 1_000;

const HEADING = "ask-to-join-heading";

const HINT = "ask-to-join-hint";

const SLUG = "ask-to-join-slug";

const REASON = "ask-to-join-reason";

const REASON_HINT = "ask-to-join-reason-hint";

const REFUSED = "ask-to-join-refused";

const ASKED = "ask-to-join-asked";

const ASKED_TITLE = "ask-to-join-asked-title";

// One sentence for every slug, so the answer cannot tell a customer from a stranger.
const ACKNOWLEDGED =
  "If a workspace goes by that slug, its Admins will see that you asked and why. If one approves, an invitation comes to your email address; nothing is sent otherwise.";

const MALFORMED: Said = {
  why: "The reason needs a character other than a space.",
  next: "Say why you are asking and send it again.",
};

const REFUSED_OTHERWISE: Said = {
  why: "The platform could not read what this screen sent.",
  next: "Reload the page and ask again.",
};

const TOO_OFTEN = "You have asked to join too often. Wait an hour and ask again.";

const UNANSWERED = "The platform did not answer, so nothing was sent. Try again in a moment.";

const saidOf = (refusal: Refusal): Said => {
  if (refusal.class === "unauthenticated") return SESSION_ENDED;
  return refusal.class === "malformed" ? MALFORMED : REFUSED_OTHERWISE;
};

// Focus is moved here once the ask lands, so the answer is what a reader meets next.
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

function SignInAgain() {
  const navigate = useNavigate();
  return (
    <Button
      type="button"
      variant="link"
      className="mt-2 px-0"
      onClick={() => {
        void navigate(leavingFor(`/sign-in${pageQuery()}`));
      }}
    >
      Sign in again
    </Button>
  );
}

function Answer(properties: {
  readonly asked: boolean;
  readonly failure: Error | ApiError | null;
}) {
  if (properties.asked) return <Asked />;
  if (properties.failure === null) return null;
  return (
    <>
      <Refused
        id={REFUSED}
        failure={properties.failure}
        saidOf={saidOf}
        unanswered={isThrottled(properties.failure) ? TOO_OFTEN : UNANSWERED}
      />
      {refusalOf(properties.failure)?.class === "unauthenticated" ? <SignInAgain /> : null}
    </>
  );
}

export function AskToJoin() {
  const api = useTRPC();
  const requestAccess = useMutation(api.person.requestAccess.mutationOptions());
  const [slug, setSlug] = useState("");
  const [reason, setReason] = useState("");
  const [asked, setAsked] = useState(false);

  useKeystroke(ASK_TO_JOIN, () => {
    document.getElementById(SLUG)?.focus();
  });

  const failure = requestAccess.error;
  const refusedAs = failure === null ? undefined : refusalOf(failure)?.class;

  const ask = (event: FormEvent) => {
    event.preventDefault();
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
          document.getElementById(ASKED)?.focus();
        },
      },
    );
  };

  return (
    <section aria-labelledby={HEADING} className="mt-8">
      <h2 id={HEADING}>Ask to join a workspace</h2>
      <p id={HINT} className="mt-1 text-muted-foreground">
        Name the workspace by its slug, the short name it goes by, such as acme-joinery. An Admin
        there can tell you it, and its Admins decide.
      </p>

      <form onSubmit={ask} className="mt-4">
        <Label htmlFor={SLUG}>Workspace slug</Label>
        <Input
          id={SLUG}
          name="slug"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          required
          aria-keyshortcuts={ASK_TO_JOIN.key}
          aria-describedby={HINT}
          className="mt-2"
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
        />

        <Label htmlFor={REASON} className="mt-4">
          Why you are asking
        </Label>
        <p id={REASON_HINT} className="mt-1 text-muted-foreground">
          One or two sentences the Admins read when they decide. Up to{" "}
          {REASON_MAX_CHARACTERS.toLocaleString("en-GB")} characters.
        </p>
        <Input
          id={REASON}
          name="reason"
          required
          maxLength={REASON_MAX_CHARACTERS}
          aria-describedby={failure === null ? REASON_HINT : `${REASON_HINT} ${REFUSED}`}
          aria-invalid={refusedAs === "malformed"}
          className="mt-2"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />

        <Button type="submit" className="mt-4" disabled={requestAccess.isPending}>
          {requestAccess.isPending ? "Asking" : "Ask to join"}
        </Button>
      </form>

      <Answer asked={asked} failure={failure} />
    </section>
  );
}
