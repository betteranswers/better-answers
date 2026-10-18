import { useCallback, useEffect, useRef, useState } from "react";

export const useLanding = () => {
  const [landAt, setLandAt] = useState<number>();
  const askedFrom = useRef<Element | null>(null);
  const landed = useCallback(() => {
    setLandAt(undefined);
  }, []);
  const landOn = useCallback((line: number) => {
    askedFrom.current = document.activeElement;
    setLandAt(line);
  }, []);

  useEffect(() => {
    if (landAt === undefined) return;
    const movedOn = (event: FocusEvent) => {
      if (event.target !== askedFrom.current) landed();
    };
    document.addEventListener("focusin", movedOn);
    return () => {
      document.removeEventListener("focusin", movedOn);
    };
  }, [landAt, landed]);

  return { landAt, landed, landOn };
};

export type Landing = ReturnType<typeof useLanding>;

export const useLandingLine = (landsHere: boolean, onLanded: () => void) =>
  useCallback(
    (line: HTMLElement | null) => {
      if (line === null || !landsHere) return;
      line.focus();
      onLanded();
    },
    [landsHere, onLanded],
  );
