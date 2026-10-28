import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type PageTab = { readonly id: string; readonly name: string };

export type PageToolbar = {
  readonly tabs?: readonly PageTab[] | undefined;
};

export const isFilled = (toolbar: PageToolbar | undefined): toolbar is PageToolbar =>
  (toolbar?.tabs ?? []).length > 0;

const OpenTab = createContext<string | undefined>(undefined);

export const useOpenTab = (): string | undefined => useContext(OpenTab);

export function OpenTabProvider(properties: {
  readonly openTab: string | undefined;
  readonly children: ReactNode;
}) {
  return <OpenTab.Provider value={properties.openTab}>{properties.children}</OpenTab.Provider>;
}

type Written = { readonly key: symbol; readonly value: unknown };

type Slot = {
  readonly written: Written | undefined;
  readonly write: (written: Written) => void;
};

const ViewState = createContext<Slot | undefined>(undefined);

export function ViewStateSlot(properties: { readonly children: ReactNode }) {
  const openTab = useOpenTab();
  const [written, setWritten] = useState<Written>();
  const [tabWritingUnder, setTabWritingUnder] = useState(openTab);

  const stale = tabWritingUnder !== openTab;
  if (stale) {
    setTabWritingUnder(openTab);
    setWritten(undefined);
  }

  const slot = useMemo<Slot>(
    () => ({ written: stale ? undefined : written, write: setWritten }),
    [stale, written],
  );

  return <ViewState.Provider value={slot}>{properties.children}</ViewState.Provider>;
}

export function viewStateOf<Value>(page: string) {
  const key = Symbol(page);
  const held = new WeakMap<Written, Value>();

  const useViewState = (): readonly [Value | undefined, (value: Value) => void] => {
    const slot = useContext(ViewState);
    const written = slot?.written;
    const writeToSlot = slot?.write;

    const value = written === undefined ? undefined : held.get(written);

    const write = useCallback(
      (next: Value) => {
        const entry: Written = { key, value: next };
        held.set(entry, next);
        writeToSlot?.(entry);
      },
      [writeToSlot],
    );

    return [value, write];
  };

  return useViewState;
}
