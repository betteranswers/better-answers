import { createContext, useContext, useEffect } from "react";

export const BreadcrumbLastPartSlot = createContext<
  ((name: string | undefined) => void) | undefined
>(undefined);

export const useBreadcrumbLastPart = (name: string | undefined): void => {
  const give = useContext(BreadcrumbLastPartSlot);
  useEffect(() => {
    give?.(name);
    return () => {
      give?.(undefined);
    };
  }, [give, name]);
};
