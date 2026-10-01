import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

/** What another place may ask of a screen as it opens: one of its acts, or a search. */
type Ask = "act" | "search";

/** Where the reader is, as the router last wrote the address. */
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
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const searchStr = useRouterState({ select: (state) => state.location.searchStr });
  const asked = new URLSearchParams(searchStr).get(ask) ?? undefined;
  const navigate = useNavigate();
  const [taken, setTaken] = useState<string>();

  // During render, so `take` may set only the caller's own state, which an abandoned render drops.
  if (asked !== taken) {
    setTaken(asked);
    if (asked !== undefined) take(asked);
  }

  useEffect(() => {
    if (asked === undefined) return;
    const rest = new URLSearchParams(searchStr);
    rest.delete(ask);
    void navigate({ href: hrefOf(pathname, rest), replace: true });
  }, [ask, asked, pathname, searchStr, navigate]);
};
