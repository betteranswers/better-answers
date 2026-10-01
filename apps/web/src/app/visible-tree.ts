import { useRouterState } from "@tanstack/react-router";
import { createContext, useContext } from "react";

import { NO_TREE, type VisibleTree } from "@/shared/navigation.ts";

/** The frame's live reading of the list, so a route waiting on the role moves once it is read. */
export const VisibleTreeContext = createContext<VisibleTree>(NO_TREE);

export const useVisibleTree = (): VisibleTree => useContext(VisibleTreeContext);

/**
 * Decided in the open screen's `beforeLoad`, so a role changed while on it takes effect at the
 * next move, not mid-act.
 */
export const useHiddenOnArrival = (): boolean =>
  useRouterState({
    select: (state) => {
      const verdict: { readonly hidden?: boolean } | undefined = state.matches.at(-1)?.context;
      return verdict?.hidden === true;
    },
  });
