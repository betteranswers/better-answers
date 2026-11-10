import { useId, useState, type RefObject } from "react";

import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { ActionDialog } from "@/shared/page/action-dialog.tsx";
import { SheetPart } from "@/shared/page/sheet-part.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { instantWords } from "@/shared/words.ts";

import { useEndEverySignInEverywhere, type ListedPerson } from "../people-api.ts";
import { nameOf } from "../person-words.tsx";
import { SheetActionButton } from "../sheet-action.tsx";
import { PERSON_WORDS, revocationRefused } from "../words.ts";

type Revocation = ReturnType<typeof useEndEverySignInEverywhere>;

const endsWhat = (name: string): string =>
  `Ends ${name}’s sessions on every device and every assistant’s access, in every workspace.`;

const outcomeOf = (revocation: Revocation, name: string): Outcome | undefined => {
  if (revocation.isPending) {
    return { tone: "said", words: `Signing ${name} out everywhere…` };
  }
  if (revocation.isSuccess) {
    return {
      tone: "said",
      words: `${name} signed out everywhere at ${instantWords(revocation.data.revokedAt)}.`,
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
    <SheetPart title={PERSON_WORDS.signOutEverywhere}>
      <p id={consequenceId} className="text-muted-foreground">
        {endsWhat(name)}
      </p>
      <SheetActionButton
        actionRef={actionRef}
        consequenceId={consequenceId}
        pending={revocation.isPending}
        onAsk={() => {
          setConfirming(true);
        }}
      >
        {PERSON_WORDS.signOutEverywhere}
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
        title={PERSON_WORDS.signOutTitle(name)}
        consequence={endsWhat(name)}
        commit={
          <Button variant="destructive" onClick={commit}>
            {PERSON_WORDS.signOutEverywhere}
          </Button>
        }
      />
    </SheetPart>
  );
}
