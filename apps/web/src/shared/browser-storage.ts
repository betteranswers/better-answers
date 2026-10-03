/**
 * A browser told to block storage throws on the getter rather than answering it; this answers
 * undefined, and the choice is then not kept.
 */
export const onThisBrowser = (): Storage | undefined => {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

/** A full or refusing store throws on a write; the choice is then not kept, and the act goes on. */
export const keepOnThisBrowser = (key: string, value: string): void => {
  try {
    onThisBrowser()?.setItem(key, value);
  } catch {
    // Losing a kept choice costs the reader one click next time; failing the act would cost more.
  }
};

/** Kept by this tab alone, through a reload, and blocked as `onThisBrowser` is. */
export const inThisTab = (): Storage | undefined => {
  if (typeof window === "undefined") return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
};
