import { useId, useState, type RefObject } from "react";

import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Card, CardHeader, CardTitle } from "@/shared/ui/card.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/ui/collapsible.tsx";

import { INCLUDES_YOU, RECORDED } from "./member-action-words.ts";
import { useReaderId, useRemovalOf, type ListedMember } from "./people-api.ts";
import { nameOf } from "./words.tsx";

/** Module-level, so React calls it once as the confirmation mounts, never on a re-render. */
const focusOnArrival = (node: HTMLElement | null) => {
  node?.focus();
};

/** Removal waits on a second, deliberate action, whose question takes focus rather than its button. */
export function MemberRemoval(properties: {
  readonly member: ListedMember;
  readonly askRef: RefObject<HTMLButtonElement | null>;
  /** None until the reader's own member read answers, which says whose removal this is. */
  readonly onRemove: ((member: ListedMember) => void) | undefined;
  /** A refusal of removing yourself, which is answered here before you leave. */
  readonly outcome: Outcome | undefined;
}) {
  const { member, askRef, onRemove } = properties;
  const [asking, setAsking] = useState(false);
  const headingId = useId();
  const consequenceId = useId();
  const recordId = useId();
  const name = nameOf(member);
  const yourself = useReaderId() === member.personId;
  const removing = useRemovalOf(member.personId)?.status === "pending";
  const offered = !removing && onRemove !== undefined;

  return (
    <Card asChild>
      <section aria-labelledby={headingId}>
        <CardHeader className="border-b py-2">
          <CardTitle asChild className="max-w-none font-medium">
            <h3 id={headingId}>Removal</h3>
          </CardTitle>
        </CardHeader>
        <Collapsible open={asking} onOpenChange={setAsking} className="grid gap-3 px-4 py-3">
          <p id={consequenceId} className="text-sm text-muted-foreground">
            {yourself
              ? "You lose access to this workspace, People included, on every session and assistant you hold. Any other workspace you belong to is untouched, and you stay named on what you checked."
              : `${name} loses access to this workspace on every session and assistant they hold. Any other workspace they belong to is untouched, and they stay named on what they checked.`}
          </p>
          <CollapsibleTrigger asChild>
            <Button
              ref={askRef}
              variant="outline"
              className="justify-self-start"
              aria-describedby={consequenceId}
            >
              Remove {name}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <fieldset className="grid gap-2 border border-border bg-muted p-3">
              <legend ref={focusOnArrival} tabIndex={-1} className="float-left font-medium">
                Confirm the removal of {name}
              </legend>
              <p id={recordId} className="text-sm text-muted-foreground">
                {yourself
                  ? `${INCLUDES_YOU} ${RECORDED} You leave your groups here too.`
                  : `${RECORDED} They leave their groups here too.`}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="destructive"
                  aria-describedby={recordId}
                  // Not `disabled`: a disabled button drops the focus the action leaves on it.
                  aria-disabled={!offered}
                  className="aria-disabled:opacity-50"
                  onClick={() => {
                    // A page drawn again mid-removal has an idle action of its own, so this is the guard.
                    if (offered) onRemove(member);
                  }}
                >
                  Remove {name} from this workspace
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setAsking(false);
                    askRef.current?.focus();
                  }}
                >
                  Keep {name}
                </Button>
              </div>
            </fieldset>
          </CollapsibleContent>
          <OutcomeLine outcome={properties.outcome} />
        </Collapsible>
      </section>
    </Card>
  );
}
