import type { ApiError } from "@/shared/api/trpc.ts";
import { OutcomeLine } from "@/shared/outcome.tsx";
import { useReadSaid } from "@/shared/read-said.ts";

import { GROUPS_LOADING } from "./member-action-words.ts";
import { outcomeOfGroupFailure } from "./refusal.tsx";

export function GroupsReadSaid(properties: {
  readonly error: Error | ApiError | null;
  readonly isPending: boolean;
}) {
  const { error, isPending } = useReadSaid(properties);
  return (
    <>
      {/* Boxless, so the line takes none of its card's gaps while it is empty. */}
      <OutcomeLine
        outcome={error === null ? undefined : outcomeOfGroupFailure(error, "read")}
        className="contents"
      />
      <div aria-live="polite" className="empty:sr-only">
        {isPending ? <p>{GROUPS_LOADING}</p> : null}
      </div>
    </>
  );
}
