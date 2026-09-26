import { useId, useState, type RefObject } from "react";

import { Button } from "@/shared/ui/button.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/ui/collapsible.tsx";

import type { ListedMember } from "./people-api.ts";
import { nameOf } from "./words.tsx";

/** Module-level, so React calls it once as the confirmation mounts, never on a re-render. */
const focusOnArrival = (node: HTMLElement | null) => {
  node?.focus();
};

/** Removal waits on a second, deliberate act, whose question takes focus rather than its button. */
export function MemberRemoval(properties: {
  readonly member: ListedMember;
  readonly askRef: RefObject<HTMLButtonElement | null>;
  readonly onRemove: (member: ListedMember) => void;
}) {
  const { member, askRef, onRemove } = properties;
  const [asking, setAsking] = useState(false);
  const headingId = useId();
  const consequenceId = useId();
  const recordId = useId();
  const name = nameOf(member);

  return (
    <section aria-labelledby={headingId} className="border border-border">
      <h3 id={headingId} className="border-b border-border px-4 py-2 font-medium">
        Removal
      </h3>
      <Collapsible open={asking} onOpenChange={setAsking} className="grid gap-3 px-4 py-3">
        <p id={consequenceId} className="text-sm text-muted-foreground">
          {name} loses access to this workspace on every session and client they hold. Any other
          workspace they belong to is untouched, and they stay named on what they checked.
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
              One governed write, recorded on the audit log under your name. Their groups here end
              with the membership.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="destructive"
                aria-describedby={recordId}
                onClick={() => {
                  onRemove(member);
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
      </Collapsible>
    </section>
  );
}
