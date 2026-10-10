/**
 * A browser told to block storage throws on the getter rather than answering it; this answers
 * undefined, and the choice is then not kept.
 */
const reached = (store: (browser: Window) => Storage): Storage | undefined => {
  if (typeof window === "undefined") return undefined;
  try {
    return store(window);
  } catch {
    return undefined;
  }
};

/** A full or refusing store throws on a write; the choice is then not kept, and the action goes on. */
const kept = (store: Storage | undefined, key: string, value: string): void => {
  try {
    store?.setItem(key, value);
  } catch {
    // Losing a kept choice costs the reader one click next time; failing the action would cost more.
  }
};

export const onThisBrowser = (): Storage | undefined => reached((browser) => browser.localStorage);

export const keepOnThisBrowser = (key: string, value: string): void => {
  kept(onThisBrowser(), key, value);
};

/** Kept by this tab alone, through a reload. */
export const inThisTab = (): Storage | undefined => reached((browser) => browser.sessionStorage);

export const keepInThisTab = (key: string, value: string): void => {
  kept(inThisTab(), key, value);
};

export const forgetOnThisBrowser = (key: string): void => {
  try {
    onThisBrowser()?.removeItem(key);
  } catch {
    // A refusing store keeps what it held; the choice shown is still the one made.
  }
};
