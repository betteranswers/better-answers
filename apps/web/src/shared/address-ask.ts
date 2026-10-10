import { useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

/** What another place may ask of a page as it opens: one of its actions, or a search. */
export type Ask = "action" | "search";

/** Each ask's older key, which a bookmark or a saved sign-in return address can still carry. */
const ASKED_BEFORE = {
  action: "act",
  search: undefined,
} as const satisfies Readonly<Record<Ask, string | undefined>>;

/** Whether the router would read a value as JSON, and the string it would read where it is one. */
type Read = { readonly asJson: boolean; readonly string: string | undefined };

const readOf = (value: string): Read => {
  try {
    const read: unknown = JSON.parse(value);
    return { asJson: true, string: typeof read === "string" ? read : undefined };
  } catch {
    // That it is no JSON is the whole answer, so the error says nothing more.
    return { asJson: false, string: undefined };
  }
};

/** The router re-types a value that reads as JSON, `1.50` to `1.5`, and carries its JSON string whole. */
const written = (value: string): string => (readOf(value).asJson ? JSON.stringify(value) : value);

export const askedIn = (query: URLSearchParams, ask: Ask): string | undefined => {
  const before = ASKED_BEFORE[ask];
  const asked = query.get(ask) ?? (before === undefined ? null : query.get(before));
  return asked === null ? undefined : (readOf(asked).string ?? asked);
};

export type Here = { readonly pathname: string; readonly searchStr: string };

export const addressOf = (path: string, query: Readonly<Record<string, string>>): string =>
  `${path}?${new URLSearchParams(query).toString()}`;

const hrefOf = (path: string, query: URLSearchParams): string => {
  const words = query.toString();
  return words === "" ? path : `${path}?${words}`;
};

/** Asking another page drops the open page's query. */
export const askingHere = (here: Here, path: string, ask: Ask, value: string): string => {
  const query = new URLSearchParams(here.pathname === path ? here.searchStr : "");
  query.set(ask, written(value));
  return hrefOf(path, query);
};

/**
 * Taken in the render that sees it, so an open page takes it too. Clearing only its key keeps a
 * reload from asking again.
 */
export const useAsked = (ask: Ask, take: (value: string) => void): void => {
  // Its own key alone, so a list writing the rest of the query does not draw the page again.
  const asked = useRouterState({
    select: (state) => askedIn(new URLSearchParams(state.location.searchStr), ask),
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
    const before = ASKED_BEFORE[ask];
    if (before !== undefined) rest.delete(before);
    void router.navigate({ href: hrefOf(pathname, rest), replace: true });
  }, [ask, asked, router]);
};
