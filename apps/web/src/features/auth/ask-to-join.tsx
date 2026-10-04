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

import { ASK_TO_JOIN_WORDS, REASON_MAX_CHARACTERS, SLUG_EXAMPLE } from "./ask-to-join-words.ts";
import { focusOn, Refused } from "./auth-page.tsx";
import { ASK_REFUSED, ASK_UNANSWERED, askedTooOften, REASON_REFUSED } from "./refusal-words.ts";

export const ASK_TO_JOIN: Keystroke = { key: "j", act: ASK_TO_JOIN_WORDS.heading };

const HEADING = "ask-to-join-heading";

const SLUG_FIELD = "ask-to-join-slug";

const SLUG_HINT = "ask-to-join-slug-hint";

const REASON_FIELD = "ask-to-join-reason";

const REASON_HINT = "ask-to-join-reason-hint";

const REFUSED = "ask-to-join-refused";

const SENT = "ask-to-join-sent";

const SENT_TITLE = "ask-to-join-sent-title";

const saidOf = (refusal: Refusal): Said =>
  refusal.class === "malformed" ? REASON_REFUSED : ASK_REFUSED;

const unansweredOf = (failure: Error | ApiError): Said => {
  const liftsInSeconds = ceilingLiftsIn(failure);
  return liftsInSeconds === undefined ? ASK_UNANSWERED : askedTooOften(liftsInSeconds);
};

/** Focus is moved here once the ask lands, so the answer is what a reader meets next. */
function RequestSent() {
  return (
    <div
      id={SENT}
      role="alert"
      aria-labelledby={SENT_TITLE}
      tabIndex={-1}
      className="mt-4 border border-border p-3"
    >
      <p id={SENT_TITLE} className="font-medium text-foreground">
        {ASK_TO_JOIN_WORDS.sent}
      </p>
      <p className="mt-1 text-muted-foreground">{ASK_TO_JOIN_WORDS.whatHappensNext}</p>
    </div>
  );
}

/** The refusal's region stands empty from the first render; the sent answer is met by focus. */
function AskOutcome(properties: {
  readonly sent: boolean;
  readonly failure: Error | ApiError | null;
}) {
  const { failure } = properties;
  return (
    <>
      <Refused
        id={REFUSED}
        failure={failure}
        saidOf={saidOf}
        unanswered={failure === null ? ASK_UNANSWERED : unansweredOf(failure)}
      />
      {properties.sent ? <RequestSent /> : null}
    </>
  );
}

export function AskToJoin() {
  const api = useTRPC();
  const requestAccess = useMutation(api.person.requestAccess.mutationOptions());
  const [slug, setSlug] = useState("");
  const [reason, setReason] = useState("");
  const [sent, setSent] = useState(false);

  useKeystroke(ASK_TO_JOIN, () => {
    focusOn(SLUG_FIELD);
  });

  const failure = requestAccess.error;
  const refusedAs = failure === null ? undefined : refusalOf(failure)?.class;

  const ask = (event: FormEvent) => {
    event.preventDefault();
    // The button stays enabled while asking, so the focus a click gave it is not dropped.
    if (requestAccess.isPending) return;
    setSent(false);
    requestAccess.mutate(
      { slug, reason },
      {
        onSuccess: () => {
          flushSync(() => {
            setSlug("");
            setReason("");
            setSent(true);
          });
          focusOn(SENT);
        },
        onError: (refused) => {
          if (refusalOf(refused)?.class === "malformed") focusOn(REASON_FIELD);
        },
      },
    );
  };

  return (
    <section aria-labelledby={HEADING} className="mt-8">
      <h2 id={HEADING}>{ASK_TO_JOIN_WORDS.heading}</h2>

      <form onSubmit={ask} className="mt-4">
        <Label htmlFor={SLUG_FIELD}>{ASK_TO_JOIN_WORDS.slug}</Label>
        <p id={SLUG_HINT} className="mt-1 text-muted-foreground">
          {ASK_TO_JOIN_WORDS.forExample} <code className="font-mono">{SLUG_EXAMPLE}</code>
        </p>
        <Input
          id={SLUG_FIELD}
          name="slug"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          required
          aria-keyshortcuts={ASK_TO_JOIN.key}
          aria-describedby={SLUG_HINT}
          className="mt-2 font-mono"
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
        />

        <Label htmlFor={REASON_FIELD} className="mt-4">
          {ASK_TO_JOIN_WORDS.reason}
        </Label>
        <p id={REASON_HINT} className="mt-1 text-muted-foreground">
          {ASK_TO_JOIN_WORDS.reasonHint}
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
          {requestAccess.isPending ? ASK_TO_JOIN_WORDS.asking : ASK_TO_JOIN_WORDS.ask}
        </Button>
      </form>

      <AskOutcome sent={sent} failure={failure} />
    </section>
  );
}
