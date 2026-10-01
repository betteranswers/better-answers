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

const landedAs = (role: Role): string =>
  `You changed your own role to ${role}. People is for Admins, so this is your home now.`;

const ROLE_UNREAD = refusedWith({
  why: "Your role changed, but it couldn't be read again.",
  next: "Reload the page in a moment.",
});

/** Carried in the landing entry's history state, so it goes once the reader moves on. */
const LANDED = z.object({ landedAs: z.string().transform(roleOf) });

/** What an act did to the reader's own membership. */
type Landing = "demoted" | "removed";

/** The line an act's confirmation adds when the people it acts on include the reader. */
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

/**
 * Lands where the act left the reader, replacing the screen they can no longer see. Answers the
 * outcome to show when it could not land.
 */
export const useSelfActLanding = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const land = async (landing: Landing): Promise<Outcome | undefined> => {
    if (landing === "removed") {
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
      state: (previous) => ({ ...previous, landedAs: role }),
    });
    return undefined;
  };

  return { land };
};

/** Its live region must stand before the landing, so it belongs where the frame outlives the move. */
export function LandedLine() {
  const role = useRouterState({
    select: (state) => LANDED.safeParse(state.location.state).data?.landedAs,
  });

  return (
    <OutcomeLine
      outcome={role === undefined ? undefined : { tone: "said", words: landedAs(role) }}
    />
  );
}
