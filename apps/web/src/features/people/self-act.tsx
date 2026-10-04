import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { z } from "zod";

import { useTRPC, type ApiProxy } from "@/shared/api/trpc.ts";
import { HOMES, type Role } from "@/shared/navigation.ts";
import type { Outcome } from "@/shared/outcome.tsx";
import { refusedWith } from "@/shared/refusal-outcome.tsx";

import { homeNowSaid, INCLUDES_YOU } from "./member-act-words.ts";
import { useReaderId } from "./people-api.ts";
import { roleOf } from "./role-meanings.ts";

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

/** The reader can no longer see the page the act was taken on, so each move replaces it. */
export const useSelfActHome = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const goHome = async (change: OwnMembershipChange): Promise<Outcome | undefined> => {
    if (change === "removed") {
      // Reset, not removed: the frame's mounted read never hears a removal and draws the old role.
      void queryClient.resetQueries(membershipOf(api));
      // The chooser decides on its first read, so a workspace list held from before must not answer it.
      void queryClient.resetQueries({ type: "inactive" });
      // Not `/`: the session still names the workspace left, and the shell sends that refusal to sign-in.
      await navigate({ href: "/choose-workspace", replace: true });
      return undefined;
    }
    const role = await roleReadAgain(queryClient, api);
    // The held answer stays: dropping it would leave the page with no role to draw.
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

  // A status alone: this line never refuses, and the frame keeps it on every page.
  return (
    <output className="mb-4 block text-muted-foreground empty:hidden">
      {role === undefined ? null : homeNowSaid(role)}
    </output>
  );
}
