import { useId, useState, type RefObject } from "react";

import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { Checkbox } from "@/shared/ui/checkbox.tsx";
import { Label } from "@/shared/ui/label.tsx";

import { useGroupMoves, type InGroup } from "./groups-api.ts";
import { outcomeOfGroupFailure } from "./refusal.tsx";

type Choice = {
  readonly id: string;
  readonly label: string;
  /** Read out after the label, as the box's description. */
  readonly detail: string | undefined;
  readonly checked: boolean;
};

type Pair = {
  readonly inGroup: InGroup;
  readonly person: string;
  readonly group: string;
};

/**
 * The multi-select both sheets carry: each box puts one member in one group, or takes them out,
 * the moment it is ticked or cleared.
 */
export function GroupChecklist(properties: {
  readonly legend: string;
  readonly hint: string;
  readonly choices: readonly Choice[];
  readonly pairOf: (choiceId: string) => Pair | undefined;
  readonly listRef?: RefObject<HTMLFieldSetElement | null>;
}) {
  const { legend, hint, choices, pairOf, listRef } = properties;
  const [outcome, setOutcome] = useState<Outcome>();
  const moves = useGroupMoves();
  const ids = { hint: useId(), box: useId() };

  const move = (choiceId: string, ticked: boolean) => {
    const pair = pairOf(choiceId);
    if (pair === undefined) return;
    setOutcome(undefined);
    const said = ticked
      ? `${pair.person} is in ${pair.group} now.`
      : `${pair.person} is out of ${pair.group} now.`;
    void (ticked ? moves.putIn : moves.takeOut)(pair.inGroup).then(
      () => {
        setOutcome({ tone: "said", words: said });
      },
      (failure: Error) => {
        setOutcome(outcomeOfGroupFailure(failure));
      },
    );
  };

  return (
    <>
      <OutcomeLine outcome={outcome} />
      <fieldset ref={listRef} aria-describedby={ids.hint} className="grid gap-3">
        <legend className="sr-only">{legend}</legend>
        <p id={ids.hint} className="text-sm text-muted-foreground">
          {hint}
        </p>
        {choices.map((choice) => {
          const boxId = `${ids.box}-${choice.id}`;
          const detailId = `${boxId}-detail`;
          return (
            <div key={choice.id} className="flex items-start gap-3">
              <Checkbox
                id={boxId}
                checked={choice.checked}
                className="mt-0.5"
                aria-describedby={choice.detail === undefined ? undefined : detailId}
                onCheckedChange={(checked) => {
                  move(choice.id, checked === true);
                }}
              />
              <div className="grid min-w-0 gap-0.5">
                <Label htmlFor={boxId} className="font-medium">
                  {choice.label}
                </Label>
                {choice.detail === undefined ? null : (
                  <span id={detailId} className="text-xs text-muted-foreground wrap-anywhere">
                    {choice.detail}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </fieldset>
    </>
  );
}
