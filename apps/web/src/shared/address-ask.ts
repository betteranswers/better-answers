import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

/** What another place may ask of a screen as it opens: one of its acts, or a search. */
type Ask = "act" | "search";

export const addressOf = (path: string, query: Readonly<Record<string, string>>): string =>
  `${path}?${new URLSearchParams(query).toString()}`;

/** The router re-types a value that reads as JSON, so only words and addresses are asked. */
export const asking = (path: string, ask: Ask, value: string): string =>
  addressOf(path, { [ask]: value });

/**
 * Taken in the render that sees it, so an open screen takes it too; then cleared, so a reload
 * does not ask again.
 */
export const useAsked = (ask: Ask, take: (value: string) => void): void => {
  const asked = useRouterState({
    select: (state) => new URLSearchParams(state.location.searchStr).get(ask) ?? undefined,
  });
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const [taken, setTaken] = useState<string>();

  // During render, so `take` may set only the caller's own state, which an abandoned render drops.
  if (asked !== taken) {
    setTaken(asked);
    if (asked !== undefined) take(asked);
  }

  useEffect(() => {
    if (asked !== undefined) void navigate({ href: pathname, replace: true });
  }, [asked, pathname, navigate]);
};
