import { useId, useState, type RefObject } from "react";

import { ActDialog } from "@/shared/act-dialog.tsx";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { SheetPart } from "@/shared/sheet-part.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { instantWords } from "@/shared/words.ts";

import { backTo } from "./people-address.ts";
import { useRevokeEverywhere, type ListedPerson } from "./people-api.ts";
import { nameOf } from "./person-words.tsx";
import { SheetActButton } from "./sheet-act.tsx";
import { SignInAgain } from "./sign-in-again.tsx";
import { refusedAsStale, revocationRefused } from "./words.ts";

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

  return (
    <SheetPart title="Revoke everywhere">
      <p id={consequenceId} className="text-muted-foreground">
        Ends every session and client grant {name} holds, in every workspace, at once. They can sign
        in again afterwards. Recorded on the identity-set audit log under your name.
      </p>
      <SheetActButton
        actRef={actRef}
        consequenceId={consequenceId}
        pending={revocation.isPending}
        onAsk={() => {
          setConfirming(true);
        }}
      >
        Revoke {name}'s credentials everywhere
      </SheetActButton>
      <OutcomeLine outcome={outcomeOf(revocation, name)} />
      {refusedAsStale(revocation.error) ? <SignInAgain back={backTo(person, "revoke")} /> : null}

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
