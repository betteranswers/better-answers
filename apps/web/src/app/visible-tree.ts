import { useRouter, useRouterState } from "@tanstack/react-router";
import { createContext, useContext, useEffect } from "react";

import { hides, NO_TREE, type VisibleTree } from "@/shared/navigation.ts";

/** The frame's live reading of the list, so a route waiting on the role moves once it is read. */
export const VisibleTreeContext = createContext<VisibleTree>(NO_TREE);

export const useVisibleTree = (): VisibleTree => useContext(VisibleTreeContext);

type Arrival = { readonly hidden?: boolean; readonly unread?: boolean };

const useArrival = (found: keyof Arrival): boolean =>
  useRouterState({
    select: (state) => {
      const arrival: Arrival | undefined = state.matches.at(-1)?.context;
      return arrival?.[found] === true;
    },
  });

/**
 * Decided on arrival, so a role changed mid-act waits for the next move. An arrival without a
 * role follows the list until retaken.
 */
export const useHidden = (tree: VisibleTree, path: string): boolean => {
  const hidden = useArrival("hidden");
  const unread = useArrival("unread");
  return hidden || (unread && hides(tree, path));
};

/**
 * Retakes an arrival without a role once the role is read, so its verdict holds to the next move.
 * The router is outside React.
 */
export const useArrivalTakenOnceRead = (tree: VisibleTree): void => {
  const router = useRouter();
  const unread = useArrival("unread");
  const read = tree.home !== undefined;

  useEffect(() => {
    if (unread && read) void router.invalidate();
  }, [router, unread, read]);
};
