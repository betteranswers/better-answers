// A browser told to block storage throws on the getter rather than answering it; the choice
// is then simply not kept.
export const onThisBrowser = (): Storage | undefined => {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};
