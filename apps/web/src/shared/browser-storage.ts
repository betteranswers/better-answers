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
