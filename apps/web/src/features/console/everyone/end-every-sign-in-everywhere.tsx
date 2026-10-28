import { useId, useState, type RefObject } from "react";

import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { ActionDialog } from "@/shared/page/action-dialog.tsx";
import { SheetPart } from "@/shared/page/sheet-part.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { instantWords } from "@/shared/words.ts";

import { useEndEverySignInEverywhere, type ListedPerson } from "../people-api.ts";
import { nameOf } from "../person-words.tsx";
import { SheetActionButton } from "../sheet-action.tsx";
import { revocationRefused } from "../words.ts";

type Revocation = ReturnType<typeof useEndEverySignInEverywhere>;

const outcomeOf = (revocation: Revocation, name: string): Outcome | undefined => {
  if (revocation.isPending) {
    return { tone: "said", words: `Ending every sign-in and token ${name} holds, everywhere.` };
  }
  if (revocation.isSuccess) {
    return {
      tone: "said",
      words: `${name}’s sessions and assistant access were ended successfully at ${instantWords(revocation.data.revokedAt)}.`,
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

  const commit = () => {
    setConfirming(false);
    revocation.mutate({ personId: person.id });
  };

  return (
    <SheetPart title="End Every Sign-In Everywhere">
      <p id={consequenceId} className="text-muted-foreground">
        This will end every session and every assistant’s access {name} holds, in every workspace.
        They can sign in again afterwards.
      </p>
      <SheetActionButton
        actionRef={actionRef}
        consequenceId={consequenceId}
        pending={revocation.isPending}
        onAsk={() => {
          setConfirming(true);
        }}
      >
        End Every Sign-In and Token
      </SheetActionButton>
      <OutcomeLine outcome={outcomeOf(revocation, name)} />

      <ActionDialog
        open={confirming}
        onOpenChange={setConfirming}
        content={{
          onCloseAutoFocus: (event) => {
            event.preventDefault();
            actionRef.current?.focus();
          },
        }}
        title={`End Every Sign-In and Token for ${name}`}
        consequence={`Are you sure you want to end every session and every assistant’s access ${name} holds, in every workspace? This action cannot be undone.`}
        commit={
          <Button variant="destructive" onClick={commit}>
            End Every Sign-In Everywhere
          </Button>
        }
      />
    </SheetPart>
  );
}
