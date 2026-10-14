import type { QueryClient } from "@tanstack/react-query";
import { useRouterState, type HistoryState } from "@tanstack/react-router";
import { z } from "zod";

import { refusalOf, type ApiProxy } from "@/shared/api/trpc.ts";
import { WORKSPACE_SWITCHED } from "@/shared/member.ts";
import type { Outcome } from "@/shared/outcome.tsx";
import { refusedWith } from "@/shared/refusal-outcome.tsx";
import { refusalSentence } from "@/shared/refusal-words.ts";

import { followTheSession } from "./auth-hooks.ts";

/** Carried in the home entry's history state, so it goes once the person moves on. */
const LANDED: HistoryState & { readonly switchedElsewhere: true } = { switchedElsewhere: true };

const landed = z.object({ switchedElsewhere: z.literal(true) });

/** Nothing the left page carried goes on: its entry's state was said of the workspace left. */
const HOME = { href: "/", replace: true, state: () => LANDED } as const;

const SAID = refusedWith(refusalSentence({}, WORKSPACE_SWITCHED, "conflict"));

type Reading = { readonly queryClient: QueryClient; readonly api: ApiProxy };

/**
 * Joined by a refusal landing meanwhile: a second follow's fresh read cancels the first's, so a page
 * refused over and over never lands.
 */
const following = new WeakMap<QueryClient, Promise<typeof HOME>>();

const followedOnce = (reading: Reading): Promise<typeof HOME> => {
  const underWay = following.get(reading.queryClient);
  if (underWay !== undefined) return underWay;
  const followed = followTheSession(reading.queryClient, reading.api)
    .then(() => HOME)
    .finally(() => following.delete(reading.queryClient));
  following.set(reading.queryClient, followed);
  return followed;
};

/**
 * Told by the word alone, never the address: a refusal that lands after the person left the page
 * still means the tab is stale.
 */
export const homeAfterASwitchElsewhere = (
  failure: Error,
  reading: Reading,
): Promise<typeof HOME> | undefined =>
  refusalOf(failure)?.word === WORKSPACE_SWITCHED ? followedOnce(reading) : undefined;

/** Said in the band, which outlives the page the frame draws afresh for the new workspace. */
export const useSwitchedElsewhereSaid = (): Outcome | undefined => {
  const said = useRouterState({
    select: (state) => landed.safeParse(state.location.state).success,
  });
  return said ? SAID : undefined;
};
