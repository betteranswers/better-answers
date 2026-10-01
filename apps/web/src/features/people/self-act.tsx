import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { z } from "zod";

import { useTRPC, type ApiProxy } from "@/shared/api/trpc.ts";
import { HOMES, type Role } from "@/shared/navigation.ts";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { refusedWith } from "@/shared/refusal-outcome.tsx";

import { useReaderId } from "./people-api.ts";
import { roleOf } from "./role-meanings.ts";

const INCLUDES_YOU = "This includes you.";

const homeNowSaid = (role: Role): string =>
  `You changed your own role to ${role}. People is for Admins, so this is your home now.`;

const ROLE_UNREAD = refusedWith({
  why: "Your role changed, but it couldn't be read again.",
  next: "Reload the page in a moment.",
});

/** Carried in the home entry's history state, so it goes once the reader moves on. */
const SENT_HOME = z.object({ homeOf: z.string().transform(roleOf) });

type OwnMembershipChange = "demoted" | "removed";

export const useIncludesYou = (personIds: readonly string[]): string | undefined => {
  const readerId = useReaderId();
  return readerId !== undefined && personIds.includes(readerId) ? INCLUDES_YOU : undefined;
};

const membershipOf = (api: ApiProxy) => ({
  queryKey: api.session.membership.queryKey(),
  exact: true,
});

/** `refetchQueries` resolves on a failed or paused read too, so only a settled answer counts. */
const roleReadAgain = async (
  queryClient: QueryClient,
  api: ApiProxy,
): Promise<Role | undefined> => {
  const membership = membershipOf(api);
  await queryClient.refetchQueries(membership);
  const read = queryClient.getQueryState(membership.queryKey);
  return read?.status === "success" && read.fetchStatus === "idle" ? read.data?.role : undefined;
};

/** The reader can no longer see the screen the act was taken on, so each move replaces it. */
export const useSelfActHome = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const goHome = async (change: OwnMembershipChange): Promise<Outcome | undefined> => {
    if (change === "removed") {
      // Reset, not removed: the frame's mounted read never hears a removal and draws the old role.
      void queryClient.resetQueries(membershipOf(api));
      await navigate({ href: "/", replace: true });
      return undefined;
    }
    const role = await roleReadAgain(queryClient, api);
    // The held answer stays: dropping it would leave the screen with no role to draw.
    if (role === undefined) return ROLE_UNREAD;
    await navigate({
      href: HOMES[role].path,
      replace: true,
      state: (previous) => ({ ...previous, homeOf: role }),
    });
    return undefined;
  };

  return { goHome };
};

/** Its live region must stand before the move home, so it belongs where the frame outlives it. */
export function HomeLine() {
  const role = useRouterState({
    select: (state) => SENT_HOME.safeParse(state.location.state).data?.homeOf,
  });

  return (
    <OutcomeLine
      outcome={role === undefined ? undefined : { tone: "said", words: homeNowSaid(role) }}
    />
  );
}
