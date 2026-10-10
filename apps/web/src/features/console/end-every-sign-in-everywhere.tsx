import { useId, useState, type RefObject } from "react";

import { ActionDialog } from "@/shared/action-dialog.tsx";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { SheetPart } from "@/shared/sheet-part.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { instantWords } from "@/shared/words.ts";

import { backTo } from "./people-address.ts";
import { useEndEverySignInEverywhere, type ListedPerson } from "./people-api.ts";
import { nameOf } from "./person-words.tsx";
import { SheetActionButton } from "./sheet-action.tsx";
import { SignInAgain } from "./sign-in-again.tsx";
import { refusedAsStale, revocationRefused } from "./words.ts";

type Revocation = ReturnType<typeof useEndEverySignInEverywhere>;

const outcomeOf = (revocation: Revocation, name: string): Outcome | undefined => {
  if (revocation.isPending) {
    return { tone: "said", words: `Ending every sign-in and token ${name} holds, everywhere.` };
  }
  if (revocation.isSuccess) {
    return {
      tone: "said",
      words: `${name}’s sessions and assistant access ended at ${instantWords(revocation.data.revokedAt)}. They can sign in again.`,
    };
  }
  return revocation.isError ? revocationRefused(revocation.error, "action") : undefined;
};

export function EndEverySignInEverywhere(properties: {
  readonly person: ListedPerson;
  readonly actionRef: RefObject<HTMLButtonElement | null>;
}) {
  const { person, actionRef } = properties;
  const [confirming, setConfirming] = useState(false);
  const revocation = useEndEverySignInEverywhere(person.id);
  const consequenceId = useId();
  const name = nameOf(person);

  /** The dialog closes first, so focus is back on the action when the sessions empty. */
  const commit = () => {
    setConfirming(false);
    revocation.mutate({ personId: person.id });
  };

  return (
    <SheetPart title="End every sign-in everywhere">
      <p id={consequenceId} className="text-muted-foreground">
        Ends every session and every assistant’s access {name} holds, in every workspace, at once.
        They can sign in again afterwards. Recorded on the identity-set audit log under your name.
      </p>
      <SheetActionButton
        actionRef={actionRef}
        consequenceId={consequenceId}
        pending={revocation.isPending}
        onAsk={() => {
          setConfirming(true);
        }}
      >
        End every sign-in and token {name} holds
      </SheetActionButton>
      <OutcomeLine outcome={outcomeOf(revocation, name)} />
      {refusedAsStale(revocation.error) ? <SignInAgain back={backTo(person, "revoke")} /> : null}

      <ActionDialog
        open={confirming}
        onOpenChange={setConfirming}
        content={{
          onCloseAutoFocus: (event) => {
            event.preventDefault();
            actionRef.current?.focus();
          },
        }}
        title={`End every sign-in and token ${name} holds`}
        consequence={`Every session and every assistant’s access ${name} holds ends now, in every workspace they belong to. They can sign in and connect an assistant again afterwards; this page cannot undo it.`}
        commit={
          <Button variant="destructive" onClick={commit}>
            End every sign-in everywhere
          </Button>
        }
      />
    </SheetPart>
  );
}
