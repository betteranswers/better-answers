import { OutcomeLine } from "@/shared/outcome.tsx";

import type { useGroups } from "./groups-api.ts";
import { GROUPS_LOADING } from "./member-act-words.ts";
import { outcomeOfGroupFailure } from "./refusal.tsx";

/** Both regions stand from the first render, so a screen reader hears the wait and the failure. */
export function GroupsReadSaid(properties: { readonly groups: ReturnType<typeof useGroups> }) {
  const { groups } = properties;
  return (
    <>
      <OutcomeLine
        outcome={groups.error === null ? undefined : outcomeOfGroupFailure(groups.error, "read")}
      />
      <div aria-live="polite" className="empty:hidden">
        {groups.isPending ? <p>{GROUPS_LOADING}</p> : null}
      </div>
    </>
  );
}
