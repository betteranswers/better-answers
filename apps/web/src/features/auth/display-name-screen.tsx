import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { refusalOf, type Refusal, type RefusalWord } from "@/shared/api/trpc.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Input } from "@/shared/ui/input.tsx";
import { Label } from "@/shared/ui/label.tsx";

import { useSetDisplayName } from "./auth-hooks.ts";
import { AuthScreen, Refused, SESSION_ENDED, type Said } from "./auth-screen.tsx";
import { leavingFor, nextAfterSignIn, pageQuery } from "./carried-flow.ts";

/**
 * The api's rule holds the limit; this is the number the screen tells a person before they type.
 */
const DISPLAY_NAME_MAX_CHARACTERS = 100;

const HINT = "display-name-hint";

const REFUSED = "display-name-refused";

const SAID_OF_WORD = {
  "display-name-empty": {
    why: "A display name needs a character other than a space.",
    next: "Type the name you want to be credited by.",
  },
  "display-name-not-one-line": {
    why: "A display name is one line.",
    next: "Remove the line break and save again.",
  },
  "display-name-control-character": {
    why: "A display name cannot hold a control character, such as a tab.",
    next: "Type it again rather than pasting it.",
  },
  "display-name-angle-bracket": {
    why: "A display name cannot hold < or >.",
    next: "Remove them and save again.",
  },
  "display-name-too-long": {
    why: `A display name is at most ${DISPLAY_NAME_MAX_CHARACTERS} characters.`,
    next: "Shorten it and save again.",
  },
} satisfies Partial<Record<RefusalWord, Said>>;

const WORDS = new Map<string, Said>(Object.entries(SAID_OF_WORD));

const REFUSED_OTHERWISE: Said = {
  why: "The platform could not read what this screen sent.",
  next: "Reload the page and save the name again.",
};

const UNANSWERED = "The platform did not answer, so nothing changed. Try again in a moment.";

const saidOf = (refusal: Refusal): Said =>
  WORDS.get(refusal.word) ??
  (refusal.class === "unauthenticated" ? SESSION_ENDED : REFUSED_OTHERWISE);

export function DisplayNameScreen() {
  const navigate = useNavigate();
  const [asked, setAsked] = useState("");
  const setDisplayName = useSetDisplayName();

  const failure = setDisplayName.error;
  const refusedAs = failure === null ? undefined : refusalOf(failure)?.class;

  const save = (event: FormEvent) => {
    event.preventDefault();
    setDisplayName.mutate(
      { displayName: asked },
      {
        onSuccess: () => {
          void navigate(leavingFor(nextAfterSignIn(pageQuery())));
        },
      },
    );
  };

  return (
    <AuthScreen title="Your display name">
      <p id={HINT} className="mt-2 text-muted-foreground">
        The one line the platform credits you by wherever it names you: on a check you make, as the
        author of a change, in a member list. Up to {DISPLAY_NAME_MAX_CHARACTERS} characters.
      </p>

      <form onSubmit={save} className="mt-6">
        <Label htmlFor="display-name">Display name</Label>
        <Input
          id="display-name"
          name="displayName"
          autoComplete="name"
          required
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- the code step's field is gone, and this field is the reader's next act
          autoFocus
          aria-describedby={failure === null ? HINT : `${HINT} ${REFUSED}`}
          aria-invalid={refusedAs === "malformed"}
          className="mt-2"
          value={asked}
          onChange={(event) => setAsked(event.target.value)}
        />
        <Button type="submit" className="mt-4" disabled={setDisplayName.isPending}>
          {setDisplayName.isPending ? "Saving" : "Save and continue"}
        </Button>
      </form>

      {failure === null ? null : (
        <Refused id={REFUSED} failure={failure} saidOf={saidOf} unanswered={UNANSWERED} />
      )}

      {refusedAs === "unauthenticated" ? (
        <Button
          type="button"
          variant="link"
          className="mt-6 px-0"
          onClick={() => {
            void navigate(leavingFor(`/sign-in${pageQuery()}`));
          }}
        >
          Sign in again
        </Button>
      ) : null}
    </AuthScreen>
  );
}
