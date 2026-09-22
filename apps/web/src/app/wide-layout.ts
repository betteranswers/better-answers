import { useSyncExternalStore } from "react";

const SHELL_WIDE = "--shell-wide";

const NARROW = "0";

const listen = (onChange: () => void): (() => void) => {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
};

// The stylesheet holds the breakpoint and answers which layout is in force, so the number is
// written once. Silence reads as the wide layout.
const wideNow = (): boolean => {
  if (typeof document === "undefined") return true;
  return getComputedStyle(document.documentElement).getPropertyValue(SHELL_WIDE).trim() !== NARROW;
};

export const useWideLayout = (): boolean => useSyncExternalStore(listen, wideNow);
