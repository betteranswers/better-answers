import { useCallback, useState } from "react";

/** Load more puts focus on the first line it brings, where reading resumes. */
export const useLanding = () => {
  const [landAt, setLandAt] = useState<number>();
  const landed = useCallback(() => {
    setLandAt(undefined);
  }, []);
  return { landAt, landed, landOn: setLandAt };
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
