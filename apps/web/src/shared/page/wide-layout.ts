import { useState, useSyncExternalStore } from "react";

const SHELL_WIDE = "--shell-wide";

const ROOM_BESIDE = "--room-beside";

const NARROW = "0";

const listen = (onChange: () => void): (() => void) => {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
};

const wideNow = (variable: string) => (): boolean => {
  if (typeof document === "undefined") return true;
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim() !== NARROW;
};

const shellWideNow = wideNow(SHELL_WIDE);

const roomBesideNow = wideNow(ROOM_BESIDE);

export const useWideLayout = (): boolean => useSyncExternalStore(listen, shellWideNow);

export const useRoomBeside = (): boolean => useSyncExternalStore(listen, roomBesideNow);

const NONE_HIDDEN: ReadonlySet<string> = new Set();

export const useHiddenColumns = (narrowHides: ReadonlySet<string>) => {
  const [chosen, setChosen] = useState<ReadonlySet<string>>();
  const wide = useWideLayout();
  return [chosen ?? (wide ? NONE_HIDDEN : narrowHides), setChosen] as const;
};
