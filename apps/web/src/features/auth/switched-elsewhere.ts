import type { QueryClient } from "@tanstack/react-query";
import { useRouterState, type HistoryState } from "@tanstack/react-router";
import { z } from "zod";

import { refusalOf, type ApiProxy } from "@/shared/api/trpc.ts";
import { WORKSPACE_SWITCHED } from "@/shared/member.ts";
import type { Outcome } from "@/shared/outcome.tsx";
import { refusedWith } from "@/shared/refusal-outcome.tsx";
import { saidOfRefusal } from "@/shared/refusal-words.ts";

import { followTheSession } from "./auth-hooks.ts";

/** Carried in the home entry's history state, so it goes once the person moves on. */
const LANDED: HistoryState & { readonly switchedElsewhere: true } = { switchedElsewhere: true };

const landed = z.object({ switchedElsewhere: z.literal(true) });

/** Nothing the left page carried goes on: its entry's state was said of the workspace left. */
const HOME = { href: "/", replace: true, state: () => LANDED } as const;

const SAID = refusedWith(saidOfRefusal({}, WORKSPACE_SWITCHED, "conflict"));

/**
 * Told by the word alone, never the address: a refusal that lands after the person left the page
 * still means the tab is stale.
 */
export const homeAfterASwitchElsewhere = (
  failure: Error,
  reading: { readonly queryClient: QueryClient; readonly api: ApiProxy },
): Promise<typeof HOME> | undefined =>
  refusalOf(failure)?.word === WORKSPACE_SWITCHED
    ? followTheSession(reading.queryClient, reading.api).then(() => HOME)
    : undefined;

/** Said in the band, which outlives the page the frame draws afresh for the new workspace. */
export const useSwitchedElsewhereSaid = (): Outcome | undefined => {
  const said = useRouterState({
    select: (state) => landed.safeParse(state.location.state).success,
  });
  return said ? SAID : undefined;
};
