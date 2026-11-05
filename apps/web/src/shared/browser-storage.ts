/**
 * A browser that blocks storage throws when the storage is read. This returns undefined
 * instead, and the choice is not saved.
 */
const reached = (store: (browser: Window) => Storage): Storage | undefined => {
  if (typeof window === "undefined") return undefined;
  try {
    return store(window);
  } catch {
    return undefined;
  }
};

const kept = (store: Storage | undefined, key: string, value: string): void => {
  try {
    store?.setItem(key, value);
  } catch {
    // A lost choice costs the user one click later. Failing the action would cost more.
  }
};

export const onThisBrowser = (): Storage | undefined => reached((browser) => browser.localStorage);

export const keepOnThisBrowser = (key: string, value: string): void => {
  kept(onThisBrowser(), key, value);
};

export const inThisTab = (): Storage | undefined => reached((browser) => browser.sessionStorage);

export const keepInThisTab = (key: string, value: string): void => {
  kept(inThisTab(), key, value);
};

export const forgetOnThisBrowser = (key: string): void => {
  try {
    onThisBrowser()?.removeItem(key);
  } catch {
    // If the store refuses, it keeps the old value. The page still shows the new choice.
  }
};
