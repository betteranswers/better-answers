import { useCallback, useEffect, useRef, useState } from "react";

/** Load more puts focus on the first line it brings, where reading resumes. */
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

  // Focus is the reader's once they move it, so lines that arrive after that leave it where it is.
  useEffect(() => {
    if (landAt === undefined) return;
    // A window coming back to the front gives focus to the control that had it: nothing moved.
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

/** Taken as the line mounts, so focus waits for the page of lines that brings it. */
export const useLandingLine = (landsHere: boolean, onLanded: () => void) =>
  useCallback(
    (line: HTMLElement | null) => {
      if (line === null || !landsHere) return;
      line.focus();
      onLanded();
    },
    [landsHere, onLanded],
  );
