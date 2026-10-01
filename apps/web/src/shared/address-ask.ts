import { useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

/** What another place may ask of a screen as it opens: one of its acts, or a search. */
type Ask = "act" | "search";

export type Here = { readonly pathname: string; readonly searchStr: string };

export const addressOf = (path: string, query: Readonly<Record<string, string>>): string =>
  `${path}?${new URLSearchParams(query).toString()}`;

const hrefOf = (path: string, query: URLSearchParams): string => {
  const words = query.toString();
  return words === "" ? path : `${path}?${words}`;
};

/**
 * The router re-types a value that reads as JSON, so only words and addresses are asked. The open
 * screen keeps its own query.
 */
export const asking = (path: string, ask: Ask, value: string, here?: Here): string => {
  const query = new URLSearchParams(here?.pathname === path ? here.searchStr : "");
  query.set(ask, value);
  return hrefOf(path, query);
};

/**
 * Taken in the render that sees it, so an open screen takes it too. Clearing only its key keeps a
 * reload from asking again.
 */
export const useAsked = (ask: Ask, take: (value: string) => void): void => {
  // Its own key alone, so a list writing the rest of the query does not draw the screen again.
  const asked = useRouterState({
    select: (state) => new URLSearchParams(state.location.searchStr).get(ask) ?? undefined,
  });
  const router = useRouter();
  const [taken, setTaken] = useState<string>();

  // During render, so `take` may set only the caller's own state, which an abandoned render drops.
  if (asked !== taken) {
    setTaken(asked);
    if (asked !== undefined) take(asked);
  }

  useEffect(() => {
    if (asked === undefined) return;
    // The address as history holds it, which a clear by another ask this commit has already moved.
    const { pathname, searchStr } = router.latestLocation;
    const rest = new URLSearchParams(searchStr);
    rest.delete(ask);
    void router.navigate({ href: hrefOf(pathname, rest), replace: true });
  }, [ask, asked, router]);
};
