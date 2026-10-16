import { useState } from "react";

import { keepOnThisBrowser, onThisBrowser } from "@/shared/browser-storage.ts";

/** Stored on readers' browsers, so the key keeps its first name (R22). */
const KEPT_UNDER = "better-answers.secondary-nav";

const OPEN = "open";

const CLOSED = "closed";

export type MenuShowing = {
  readonly showing: boolean;
  readonly show: (showing: boolean) => void;
};

export const useMenuShowing = (): MenuShowing => {
  const [showing, setShowing] = useState(() => onThisBrowser()?.getItem(KEPT_UNDER) !== CLOSED);

  return {
    showing,
    show: (next: boolean) => {
      setShowing(next);
      keepOnThisBrowser(KEPT_UNDER, next ? OPEN : CLOSED);
    },
  };
};
