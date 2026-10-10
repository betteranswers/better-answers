import { useState, useSyncExternalStore } from "react";

const SHELL_WIDE = "--shell-wide";

const ROOM_BESIDE = "--room-beside";

const NARROW = "0";

const listen = (onChange: () => void): (() => void) => {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
};

/**
 * The stylesheet holds the breakpoint and answers which layout is in force, so the number is
 * written once. Silence reads as the wide layout.
 */
const wideNow = (variable: string) => (): boolean => {
  if (typeof document === "undefined") return true;
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim() !== NARROW;
};

const shellWideNow = wideNow(SHELL_WIDE);

const roomBesideNow = wideNow(ROOM_BESIDE);

/** True unless the stylesheet says the narrow layout is in force; read again on every resize. */
export const useWideLayout = (): boolean => useSyncExternalStore(listen, shellWideNow);

/** True where a panel beside the page leaves the page's own content in view. */
export const useRoomBeside = (): boolean => useSyncExternalStore(listen, roomBesideNow);

const NONE_HIDDEN: ReadonlySet<string> = new Set();

/** The reader's own choice of a list's columns, else what a narrow window has room for. */
export const useHiddenColumns = (narrowHides: ReadonlySet<string>) => {
  const [chosen, setChosen] = useState<ReadonlySet<string>>();
  const wide = useWideLayout();
  return [chosen ?? (wide ? NONE_HIDDEN : narrowHides), setChosen] as const;
};
