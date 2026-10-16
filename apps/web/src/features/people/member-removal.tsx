import { useId, useState, type RefObject } from "react";

import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Card, CardHeader, CardTitle } from "@/shared/ui/card.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/ui/collapsible.tsx";

import { useReaderId, useRemovalOf, type ListedMember } from "./people-api.ts";
import { nameOf } from "./words.tsx";

/** Module-level, so React calls it once as the confirmation mounts, never on a re-render. */
const focusOnArrival = (node: HTMLElement | null) => {
  node?.focus();
};

export function MemberRemoval(properties: {
  readonly member: ListedMember;
  readonly askRef: RefObject<HTMLButtonElement | null>;
  readonly onRemove: ((member: ListedMember) => void) | undefined;
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
              ? "Removing yourself ends your access to this workspace."
              : `Removing ${name} ends their access to this workspace.`}
          </p>
          <CollapsibleTrigger asChild>
            <Button
              ref={askRef}
              variant="outline"
              className="justify-self-start"
              aria-describedby={consequenceId}
            >
              Remove Member
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <fieldset className="grid gap-2 border border-border bg-muted p-3">
              <legend ref={focusOnArrival} tabIndex={-1} className="float-left font-medium">
                Remove {name}
              </legend>
              <p id={recordId} className="text-sm text-muted-foreground">
                {yourself
                  ? "Are you sure you want to remove yourself from this workspace? You will lose access on every session and assistant you hold."
                  : "Are you sure you want to remove this member from the workspace? They will lose access on every session and assistant they hold."}
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
                  Remove
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setAsking(false);
                    askRef.current?.focus();
                  }}
                >
                  Keep Member
                </Button>
              </div>
            </fieldset>
          </CollapsibleContent>
          <OutcomeLine outcome={properties.outcome} className="contents" />
        </Collapsible>
      </section>
    </Card>
  );
}
