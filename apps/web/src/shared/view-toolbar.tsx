import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type ViewTab = { readonly id: string; readonly name: string };

export type ViewToolbar = {
  readonly tabs?: readonly ViewTab[] | undefined;
  /**
   * A route's static data is built once, so an act carries its own behaviour and reads the
   * view's own state from the slot below.
   */
  readonly acts?: ReactNode | undefined;
};

/** An empty bar above a view's content is the defect this guards. */
export const isFilled = (toolbar: ViewToolbar | undefined): toolbar is ViewToolbar =>
  (toolbar?.tabs ?? []).length > 0 || toolbar?.acts !== undefined;

const OpenTab = createContext<string | undefined>(undefined);

/**
 * A view sits under the outlet, where the shell cannot hand it a prop. Undefined when the view
 * has no tabs.
 */
export const useOpenTab = (): string | undefined => useContext(OpenTab);

export function OpenTabProvider(properties: {
  readonly openTab: string | undefined;
  readonly children: ReactNode;
}) {
  return <OpenTab.Provider value={properties.openTab}>{properties.children}</OpenTab.Provider>;
}

/**
 * Untyped here and typed where a feature declares its own helper, so the shared surface
 * stays two names wide.
 */
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

  /**
   * The way back into a thrown view is the other tab, so what the view wrote goes with the tab
   * it was written under.
   */
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

/**
 * A view declares its slot once and its content and its acts call what this hands back, so
 * the type is stated in one place.
 */
export function viewStateOf<Value>(view: string) {
  const key = Symbol(view);
  /**
   * The slot holds writes as `unknown`; this declaration's own are kept here under the object
   * it handed over, typed by construction.
   */
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
