import { useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback } from "react";

type Opening = { readonly key: string; readonly page: string; readonly searchQuery?: string };

export const useOpenMatch = (): ((opening: Opening) => void) => {
  const router = useRouter();
  const navigate = useNavigate();
  return useCallback(
    ({ key, page, searchQuery }) => {
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
        state: (held) => ({ ...held, openedMatch: undefined, searchQuery }),
      });
    },
    [router, navigate],
  );
};
