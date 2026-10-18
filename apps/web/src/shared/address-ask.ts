import { useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export type Ask = "action" | "search";

const ASKED_BEFORE = {
  action: "act",
  search: undefined,
} as const satisfies Readonly<Record<Ask, string | undefined>>;

type Read = { readonly asJson: boolean; readonly string: string | undefined };

const readOf = (value: string): Read => {
  try {
    const read: unknown = JSON.parse(value);
    return { asJson: true, string: typeof read === "string" ? read : undefined };
  } catch {
    return { asJson: false, string: undefined };
  }
};

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

export const askingHere = (here: Here, path: string, ask: Ask, value: string): string => {
  const query = new URLSearchParams(here.pathname === path ? here.searchStr : "");
  query.set(ask, written(value));
  return hrefOf(path, query);
};

export const useAsked = (ask: Ask, take: (value: string) => void): void => {
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
    const { pathname, searchStr } = router.latestLocation;
    const rest = new URLSearchParams(searchStr);
    rest.delete(ask);
    const before = ASKED_BEFORE[ask];
    if (before !== undefined) rest.delete(before);
    void router.navigate({ href: hrefOf(pathname, rest), replace: true });
  }, [ask, asked, router]);
};
