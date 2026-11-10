import { useId, useState, type RefObject } from "react";

import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Card, CardHeader, CardTitle } from "@/shared/ui/card.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/ui/collapsible.tsx";

import { MEMBER_PAGE_WORDS } from "../member-action-words.ts";
import { useReaderId, useRemovalOf, type ListedMember } from "../people-api.ts";
import { nameOf } from "../words.tsx";

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
            <h3 id={headingId}>{MEMBER_PAGE_WORDS.removal}</h3>
          </CardTitle>
        </CardHeader>
        <Collapsible open={asking} onOpenChange={setAsking} className="grid gap-3 px-4 py-3">
          <CollapsibleTrigger asChild>
            <Button ref={askRef} variant="outline" className="justify-self-start">
              {MEMBER_PAGE_WORDS.removeMember}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <fieldset className="grid gap-2 border border-border bg-muted p-3">
              <legend ref={focusOnArrival} tabIndex={-1} className="float-left font-medium">
                {MEMBER_PAGE_WORDS.removeName(name)}
              </legend>
              <p id={recordId} className="text-sm text-muted-foreground">
                {yourself
                  ? MEMBER_PAGE_WORDS.removeConfirmYou
                  : MEMBER_PAGE_WORDS.removeConfirm(name)}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="destructive"
                  aria-describedby={recordId}
                  aria-disabled={!offered}
                  className="aria-disabled:opacity-50"
                  onClick={() => {
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
                  {MEMBER_PAGE_WORDS.keepMember}
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
