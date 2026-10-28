import type { QueryClient } from "@tanstack/react-query";
import { useRouterState, type HistoryState } from "@tanstack/react-router";
import { z } from "zod";

import { refusalOf, type ApiProxy } from "@/shared/api/trpc.ts";
import { WORKSPACE_SWITCHED } from "@/shared/member/member.ts";
import type { Outcome } from "@/shared/outcome.tsx";
import { refusedWith } from "@/shared/refusal-outcome.tsx";
import { refusalSentence } from "@/shared/refusal-words.ts";

import { followTheSession } from "../auth-hooks.ts";

const LANDED: HistoryState & { readonly switchedElsewhere: true } = { switchedElsewhere: true };

const landed = z.object({ switchedElsewhere: z.literal(true) });

const HOME = { href: "/", replace: true, state: () => LANDED } as const;

const SAID = refusedWith(refusalSentence({}, WORKSPACE_SWITCHED, "conflict"));

type Reading = { readonly queryClient: QueryClient; readonly api: ApiProxy };

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

export const homeOnceLeft = (reading: Reading): Promise<typeof HOME> => followedOnce(reading);

export const homeAfterASwitchElsewhere = (
  failure: Error,
  reading: Reading,
): Promise<typeof HOME> | undefined =>
  refusalOf(failure)?.word === WORKSPACE_SWITCHED ? followedOnce(reading) : undefined;

export const useSwitchedElsewhereSaid = (): Outcome | undefined => {
  const said = useRouterState({
    select: (state) => landed.safeParse(state.location.state).success,
  });
  return said ? SAID : undefined;
};
