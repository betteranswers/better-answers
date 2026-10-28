import { useId, useRef, type SubmitEvent } from "react";

import { DISPLAY_NAME_MAX_CHARACTERS } from "@/shared/member/display-name-words.ts";
import { MountedActionDialog } from "@/shared/page/action-dialog.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Input } from "@/shared/ui/input.tsx";
import { Label } from "@/shared/ui/label.tsx";

import { correctingConsequence, correctWords } from "./correcting-words.ts";
import type { Refused } from "./use-correcting.ts";

export function CorrectNameDialog(properties: {
  readonly name: string;
  readonly displayName: string;
  readonly refused: Refused | undefined;
  readonly onSave: (displayName: string) => void;
  readonly onClose: () => void;
  readonly onFocusBack: (saved: boolean) => void;
}) {
  const { name, refused } = properties;
  const ids = { form: useId(), field: useId(), hint: useId(), refused: useId() };
  const saved = useRef(false);
  const byTheRule = refused?.byTheRule;

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const asked = new FormData(event.currentTarget).get("displayName");
    if (typeof asked !== "string") return;
    saved.current = true;
    properties.onSave(asked);
  };

  return (
    <MountedActionDialog
      onClose={properties.onClose}
      onFocusBack={() => {
        properties.onFocusBack(saved.current);
      }}
      title={correctWords(name)}
      consequence={correctingConsequence(name)}
      commit={
        <Button type="submit" form={ids.form}>
          Save Changes
        </Button>
      }
    >
      <form id={ids.form} onSubmit={submit} className="grid gap-2">
        <Label htmlFor={ids.field}>Display Name</Label>
        <Input
          id={ids.field}
          name="displayName"
          defaultValue={refused?.displayName ?? properties.displayName}
          required
          autoComplete="off"
          aria-invalid={byTheRule !== undefined}
          aria-describedby={byTheRule === undefined ? ids.hint : `${ids.hint} ${ids.refused}`}
        />
        <p id={ids.hint} className="text-sm text-muted-foreground">
          Must be one line of up to {DISPLAY_NAME_MAX_CHARACTERS} characters, with no &lt; or &gt;.
        </p>
        {byTheRule === undefined ? null : (
          <p id={ids.refused} className="text-sm">
            {byTheRule.words}
          </p>
        )}
      </form>
    </MountedActionDialog>
  );
}
