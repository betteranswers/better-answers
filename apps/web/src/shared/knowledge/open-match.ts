import { useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback } from "react";

export type OpenMatch = (
  openedMatch: string,
  page: string,
  searchQuery: string | undefined,
) => void;

export const useOpenMatch = (): OpenMatch => {
  const router = useRouter();
  const navigate = useNavigate();
  return useCallback(
    (openedMatch, page, searchQuery) => {
      void navigate({
        to: ".",
        search: true,
        replace: true,
        state: (held) => ({ ...held, openedMatch }),
      });
      // The browser's history folds a replace and a push in one task into one push.
      router.history.flush();
      void navigate({
        href: page,
        state: (held) => ({ ...held, openedMatch: undefined, searchQuery }),
      });
    },
    [router, navigate],
  );
};
