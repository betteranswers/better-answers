import { useId, useState, type RefObject } from "react";

import { OutcomeLine } from "@/shared/outcome.tsx";
import { SheetPart } from "@/shared/sheet-part.tsx";

import { CorrectNameDialog } from "./correct-name-dialog.tsx";
import { CORRECT_DISPLAY_NAME } from "./correcting-words.ts";
import type { ListedPerson } from "./people-api.ts";
import { nameOf } from "./person-words.tsx";
import { SheetActionButton } from "./sheet-action.tsx";
import { useCorrecting } from "./use-correcting.ts";

export function CorrectDisplayName(properties: {
  readonly person: ListedPerson;
  readonly actionRef: RefObject<HTMLButtonElement | null>;
}) {
  const { person, actionRef } = properties;
  const [asking, setAsking] = useState(false);
  const correcting = useCorrecting();
  const consequenceId = useId();
  const name = nameOf(person);

  /** The dialog closes first, so focus is back on the action when the name changes. */
  const save = (displayName: string) => {
    setAsking(false);
    correcting.save({ personId: person.id, was: name, displayName });
  };

  return (
    <SheetPart title="Display Name">
      <p id={consequenceId} className="text-muted-foreground">
        This will replace {name}’s display name in every workspace they belong to.
      </p>
      <SheetActionButton
        actionRef={actionRef}
        consequenceId={consequenceId}
        pending={correcting.pending}
        onAsk={() => {
          setAsking(true);
        }}
      >
        {CORRECT_DISPLAY_NAME}
      </SheetActionButton>
      <OutcomeLine outcome={correcting.outcome} />

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
            actionRef.current?.focus();
          }}
        />
      ) : null}
    </SheetPart>
  );
}
