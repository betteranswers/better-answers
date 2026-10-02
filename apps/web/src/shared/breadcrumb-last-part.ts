import { createContext, useContext, useEffect } from "react";

/**
 * The frame's, like the open tab: a page at a detail address sits under the outlet, where the
 * shell cannot read what it names.
 */
export const BreadcrumbLastPartSlot = createContext<
  ((name: string | undefined) => void) | undefined
>(undefined);

export const useBreadcrumbLastPart = (name: string | undefined): void => {
  const give = useContext(BreadcrumbLastPartSlot);
  // The band is outside the page, so it follows the page arriving and leaving.
  useEffect(() => {
    give?.(name);
    return () => {
      give?.(undefined);
    };
  }, [give, name]);
};
