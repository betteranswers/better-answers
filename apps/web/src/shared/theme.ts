import { useEffect, useSyncExternalStore } from "react";

import { forgetOnThisBrowser, keepOnThisBrowser, onThisBrowser } from "@/shared/browser-storage.ts";
import {
  DEVICE_DARK,
  showTheme,
  THEME_KEPT_UNDER,
  themeShown,
  type Theme,
} from "@/shared/theme-switch.ts";

/** A theme kept on this browser, or the device's. */
export type ThemeChoice = Theme | "device";

const kept = (): string | null => onThisBrowser()?.getItem(THEME_KEPT_UNDER) ?? null;

const choiceKept = (): ThemeChoice => {
  const theme = kept();
  return theme === "light" || theme === "dark" ? theme : "device";
};

/** Undefined where the browser answers no media query, as a test's document does not. */
const device = (): MediaQueryList | undefined =>
  typeof matchMedia === "function" ? matchMedia(DEVICE_DARK) : undefined;

const shown = (): void => {
  showTheme(themeShown(kept(), device()?.matches ?? false));
};

const listeners = new Set<() => void>();

const changed = (): void => {
  shown();
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const chooseTheme = (choice: ThemeChoice): void => {
  if (choice === "device") forgetOnThisBrowser(THEME_KEPT_UNDER);
  else keepOnThisBrowser(THEME_KEPT_UNDER, choice);
  changed();
};

export const useThemeChoice = (): ThemeChoice => useSyncExternalStore(subscribe, choiceKept);

/** Mounted once: the page follows the device while no theme is kept, and another tab's choice. */
export const useThemeFollowed = (): void => {
  useEffect(() => {
    shown();
    const media = device();
    const fromAnotherTab = (event: StorageEvent) => {
      if (event.key === THEME_KEPT_UNDER || event.key === null) changed();
    };
    media?.addEventListener("change", changed);
    window.addEventListener("storage", fromAnotherTab);
    return () => {
      media?.removeEventListener("change", changed);
      window.removeEventListener("storage", fromAnotherTab);
    };
  }, []);
};
