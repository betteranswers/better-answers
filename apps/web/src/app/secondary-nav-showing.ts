import { useState } from "react";

const KEPT_UNDER = "better-answers.secondary-nav";

const OPEN = "open";

const CLOSED = "closed";

// A browser told to block storage throws on the getter rather than answering it; the choice
// is then simply not kept.
const onThisBrowser = (): Storage | undefined => {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

export type SecondaryNavShowing = {
  readonly showing: boolean;
  readonly show: (showing: boolean) => void;
};

export const useSecondaryNavShowing = (): SecondaryNavShowing => {
  const [showing, setShowing] = useState(() => onThisBrowser()?.getItem(KEPT_UNDER) !== CLOSED);

  return {
    showing,
    show: (next: boolean) => {
      setShowing(next);
      onThisBrowser()?.setItem(KEPT_UNDER, next ? OPEN : CLOSED);
    },
  };
};
