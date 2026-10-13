import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { z } from "zod";

import { useTRPC } from "@/shared/api/trpc.ts";
import { memberChanged } from "@/shared/member.ts";
import { HOMES } from "@/shared/navigation.ts";
import type { Outcome } from "@/shared/outcome.tsx";
import { refusedWith } from "@/shared/refusal-outcome.tsx";

import { homeNowSaid, INCLUDES_YOU } from "./member-action-words.ts";
import { useReaderId } from "./people-api.ts";
import { roleOf } from "./role-meanings.ts";

export const ROLE_UNREAD = refusedWith("Your role has changed. Please reload the page.");

/** Carried in the home entry's history state, so it goes once the reader moves on. */
const SENT_HOME = z.object({ homeOf: z.string().transform(roleOf) });

type OwnMemberChange = "demoted" | "removed";

export const useIncludesYou = (personIds: readonly string[]): string | undefined => {
  const readerId = useReaderId();
  return readerId !== undefined && personIds.includes(readerId) ? INCLUDES_YOU : undefined;
};

/** The reader can no longer see the page the action was taken on, so each move replaces it. */
export const useSelfActionHome = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const goHome = async (change: OwnMemberChange): Promise<Outcome | undefined> => {
    // What the reader may see has changed, so no read held from before answers a page they open next.
    void queryClient.resetQueries({ type: "inactive" });
    if (change === "removed") {
      // No member is left to read, so the held answer goes unread.
      void memberChanged(queryClient, api, { readAgain: false, ifUnread: "reset" });
      // Not `/`: the session still names the workspace left, and the shell sends that refusal to sign-in.
      await navigate({ href: "/choose-workspace", replace: true });
      return undefined;
    }
    // The held answer stays: dropping it would leave the page with no role to draw.
    const member = await memberChanged(queryClient, api, { readAgain: true, ifUnread: "keep" });
    if (member === undefined) return ROLE_UNREAD;
    const { role } = member;
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
    <output className="mb-4 block text-muted-foreground empty:sr-only">
      {role === undefined ? null : homeNowSaid(role)}
    </output>
  );
}
