import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { refusalOf, type Refusal } from "@/shared/api/trpc.ts";
import { DISPLAY_NAME_REFUSED, DISPLAY_NAME_WORDS } from "@/shared/display-name-words.ts";
import { saidOfRefusal, type Said } from "@/shared/refusal-words.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Input } from "@/shared/ui/input.tsx";
import { Label } from "@/shared/ui/label.tsx";

import { useSetDisplayName } from "./auth-hooks.ts";
import { AuthPage, Refused } from "./auth-page.tsx";
import { leavingFor, nextAfterSignIn, pageQuery } from "./carried-flow.ts";

const HINT = "display-name-hint";

const REFUSED = "display-name-refused";

const saidOf = (refusal: Refusal): Said =>
  saidOfRefusal(DISPLAY_NAME_REFUSED, refusal.word, refusal.class);

export function DisplayNamePage() {
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
    <AuthPage title={DISPLAY_NAME_WORDS.heading}>
      <p id={HINT} className="mt-2 text-muted-foreground">
        {DISPLAY_NAME_WORDS.hint}
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

      <Refused id={REFUSED} failure={failure} saidOf={saidOf} />
    </AuthPage>
  );
}
