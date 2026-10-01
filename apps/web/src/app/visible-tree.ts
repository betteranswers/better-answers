import { useRouterState } from "@tanstack/react-router";
import { createContext, useContext } from "react";

import { hides, NO_TREE, type VisibleTree } from "@/shared/navigation.ts";

/** The frame's live reading of the list, so a route waiting on the role moves once it is read. */
export const VisibleTreeContext = createContext<VisibleTree>(NO_TREE);

export const useVisibleTree = (): VisibleTree => useContext(VisibleTreeContext);

/** What the open screen's `beforeLoad` found on arrival. */
type Arrival = { readonly hidden?: boolean; readonly unread?: boolean };

const useArrival = (found: keyof Arrival): boolean =>
  useRouterState({
    select: (state) => {
      const arrival: Arrival | undefined = state.matches.at(-1)?.context;
      return arrival?.[found] === true;
    },
  });

/**
 * Decided on arrival, so a role changed mid-act waits for the next move. An arrival holding no
 * role waits for the role instead.
 */
export const useHidden = (tree: VisibleTree, path: string): boolean => {
  const hidden = useArrival("hidden");
  const unread = useArrival("unread");
  return hidden || (unread && hides(tree, path));
};
