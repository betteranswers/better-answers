import { useId, useState, type RefObject } from "react";

import { OutcomeLine } from "@/shared/outcome.tsx";
import { SheetPart } from "@/shared/sheet-part.tsx";

import { CorrectNameDialog } from "./correct-name-dialog.tsx";
import { backTo } from "./people-address.ts";
import type { ListedPerson } from "./people-api.ts";
import { nameOf } from "./person-words.tsx";
import { SheetActButton } from "./sheet-act.tsx";
import { SignInAgain } from "./sign-in-again.tsx";
import { useCorrecting } from "./use-correcting.ts";
import { correctWords } from "./words.ts";

export function CorrectDisplayName(properties: {
  readonly person: ListedPerson;
  readonly actRef: RefObject<HTMLButtonElement | null>;
}) {
  const { person, actRef } = properties;
  const [asking, setAsking] = useState(false);
  const correcting = useCorrecting();
  const consequenceId = useId();
  const name = nameOf(person);

  /** The dialog closes first, so focus is back on the act when the name changes. */
  const save = (displayName: string) => {
    setAsking(false);
    correcting.save({ personId: person.id, was: name, displayName });
  };

  return (
    <SheetPart title="Display name">
      <p id={consequenceId} className="text-muted-foreground">
        Replaces {name}'s display name in every workspace they belong to, under the rule a person's
        own name follows, and ends any flag waiting on it. Recorded on the identity-set audit log
        under your name.
      </p>
      <SheetActButton
        actRef={actRef}
        consequenceId={consequenceId}
        pending={correcting.pending}
        onAsk={() => {
          setAsking(true);
        }}
      >
        {correctWords(name)}
      </SheetActButton>
      <OutcomeLine outcome={correcting.outcome} />
      {correcting.staleFor === undefined ? null : <SignInAgain back={backTo(person, "correct")} />}

      {asking ? (
        <CorrectNameDialog
          name={name}
          displayName={person.displayName}
          refused={correcting.refusedAt(person.id)}
          onSave={save}
          onClose={() => {
            setAsking(false);
          }}
          onFocusBack={() => {
            actRef.current?.focus();
          }}
        />
      ) : null}
    </SheetPart>
  );
}
