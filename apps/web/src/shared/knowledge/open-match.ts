import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useCallback } from "react";

import { OPENED_FROM } from "@/shared/knowledge/concept-address.ts";

type Opening = { readonly key: string; readonly page: string };

export const useOpenedFrom = (): string | undefined =>
  useRouterState({
    select: (state) => OPENED_FROM.safeParse(state.location.state).data?.openedFrom,
  });

export const useOpenMatch = (): ((opening: Opening) => void) => {
  const router = useRouter();
  const navigate = useNavigate();
  return useCallback(
    ({ key, page }) => {
      const { pathname, searchStr } = router.latestLocation;
      void navigate({
        to: ".",
        search: true,
        replace: true,
        state: (held) => ({ ...held, openedMatch: key }),
      });
      // TanStack's browser history folds a replace and a push queued in one microtask into one push.
      router.history.flush();
      void navigate({
        href: page,
        state: (held) => ({
          ...held,
          openedMatch: undefined,
          openedFrom: `${pathname}${searchStr}`,
        }),
      });
    },
    [router, navigate],
  );
};
