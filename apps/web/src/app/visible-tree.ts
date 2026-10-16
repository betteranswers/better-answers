import { useRouter, useRouterState } from "@tanstack/react-router";
import { createContext, useContext, useEffect } from "react";

import { hides, NO_TREE, type VisibleTree } from "@/shared/navigation.ts";

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

export const useHidden = (tree: VisibleTree, path: string): boolean => {
  const hidden = useArrival("hidden");
  const unread = useArrival("unread");
  return hidden || (unread && hides(tree, path));
};

export const useArrivalTakenOnceRead = (tree: VisibleTree): void => {
  const router = useRouter();
  const unread = useArrival("unread");
  const read = tree.home !== undefined;

  useEffect(() => {
    if (unread && read) void router.invalidate();
  }, [router, unread, read]);
};
