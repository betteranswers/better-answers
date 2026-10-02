import { useDeferredValue } from "react";

import type { ApiError } from "@/shared/api/trpc.ts";
import { OutcomeLine } from "@/shared/outcome.tsx";

import { GROUPS_LOADING } from "./member-act-words.ts";
import { outcomeOfGroupFailure } from "./refusal.tsx";

/**
 * Both regions mount empty and take the read's state a render later: words inside a live region as
 * it is inserted may go unread.
 */
export function GroupsReadSaid(properties: {
  readonly error: Error | ApiError | null;
  readonly isPending: boolean;
}) {
  const error = useDeferredValue(properties.error, null);
  const isPending = useDeferredValue(properties.isPending, false);
  return (
    <>
      <OutcomeLine outcome={error === null ? undefined : outcomeOfGroupFailure(error, "read")} />
      <div aria-live="polite" className="empty:hidden">
        {isPending ? <p>{GROUPS_LOADING}</p> : null}
      </div>
    </>
  );
}
