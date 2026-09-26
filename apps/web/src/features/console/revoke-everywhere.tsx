import { Link } from "@tanstack/react-router";
import { useId, useState, type RefObject } from "react";

import { refusalOf } from "@/shared/api/trpc.ts";
import { ActDialog } from "@/shared/act-dialog.tsx";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { instantWords } from "@/shared/words.ts";

import { backTo } from "./everyone-address.ts";
import { SheetPart } from "./sheet-part.tsx";
import { useRevokeEverywhere, type ListedPerson } from "./people-api.ts";
import { nameOf } from "./person-words.tsx";
import { revocationRefused, SIGN_IN_TOO_OLD } from "./words.ts";

type Revocation = ReturnType<typeof useRevokeEverywhere>;

const outcomeOf = (revocation: Revocation, name: string): Outcome | undefined => {
  if (revocation.isPending) {
    return { tone: "said", words: `Revoking ${name}'s credentials everywhere.` };
  }
  if (revocation.isSuccess) {
    return {
      tone: "said",
      words: `${name}'s sessions and client grants ended at ${instantWords(revocation.data.revokedAt)}. They can sign in again.`,
    };
  }
  return revocation.isError ? revocationRefused(revocation.error) : undefined;
};

/** A stale sign-in's way on: sign in again and land back on this person, at this act. */
function SignInAgain(properties: { readonly person: ListedPerson }) {
  return (
    <Link
      to="/sign-in"
      search={{ redirect: backTo(properties.person) }}
      className="justify-self-start text-brand underline"
    >
      Sign in again
    </Link>
  );
}

export function RevokeEverywhere(properties: {
  readonly person: ListedPerson;
  readonly actRef: RefObject<HTMLButtonElement | null>;
}) {
  const { person, actRef } = properties;
  const [confirming, setConfirming] = useState(false);
  const revocation = useRevokeEverywhere(person.id);
  const consequenceId = useId();
  const name = nameOf(person);

  /** The dialog closes first, so focus is back on the act when the sessions empty. */
  const commit = () => {
    setConfirming(false);
    revocation.mutate({ personId: person.id });
  };

  const stale = revocation.isError && refusalOf(revocation.error)?.word === SIGN_IN_TOO_OLD;

  return (
    <SheetPart title="Revoke everywhere">
      <p id={consequenceId} className="text-muted-foreground">
        Ends every session and client grant {name} holds, in every workspace, at once. They can sign
        in again afterwards. Recorded on the identity-set audit log under your name.
      </p>
      {/* Held, not disabled, while the api answers: focus comes back here when the dialog closes. */}
      <Button
        ref={actRef}
        variant="outline"
        aria-describedby={consequenceId}
        aria-haspopup="dialog"
        aria-disabled={revocation.isPending}
        className="h-auto min-h-8 justify-self-start text-left whitespace-normal aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        onClick={() => {
          if (!revocation.isPending) setConfirming(true);
        }}
      >
        Revoke {name}'s credentials everywhere
      </Button>
      <OutcomeLine outcome={outcomeOf(revocation, name)} />
      {stale ? <SignInAgain person={person} /> : null}

      <ActDialog
        open={confirming}
        onOpenChange={setConfirming}
        content={{
          onCloseAutoFocus: (event) => {
            event.preventDefault();
            actRef.current?.focus();
          },
        }}
        title={`Revoke ${name}'s credentials everywhere`}
        consequence={`Every session and client grant ${name} holds ends now, in every workspace they belong to. They can sign in and connect a client again afterwards; this screen cannot undo it.`}
        commit={
          <Button variant="destructive" onClick={commit}>
            Revoke everywhere
          </Button>
        }
      />
    </SheetPart>
  );
}
