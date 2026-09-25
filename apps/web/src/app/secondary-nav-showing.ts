import { useState } from "react";

import { onThisBrowser } from "@/shared/browser-storage.ts";

const KEPT_UNDER = "better-answers.secondary-nav";

const OPEN = "open";

const CLOSED = "closed";

export type SecondaryNavShowing = {
  readonly showing: boolean;
  readonly show: (showing: boolean) => void;
};

/** Kept on this browser: the nav shows unless the reader last hid it here. */
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
