import { createContext, useContext, useEffect } from "react";

/**
 * The frame's, like the open tab: a page at a detail address sits under the outlet, where the
 * shell cannot read what it names.
 */
export const LastCrumbSlot = createContext<((name: string | undefined) => void) | undefined>(
  undefined,
);

/** Names the breadcrumb's last part while the page that calls it is drawn. */
export const useLastCrumb = (name: string | undefined): void => {
  const give = useContext(LastCrumbSlot);
  // The band is outside the page, so it follows the page arriving and leaving.
  useEffect(() => {
    give?.(name);
    return () => {
      give?.(undefined);
    };
  }, [give, name]);
};
