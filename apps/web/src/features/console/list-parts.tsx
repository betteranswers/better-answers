import { useMemo, useRef, useState, type ReactNode, type RefObject } from "react";

import type { ApiError } from "@/shared/api/trpc.ts";
import { ListState } from "@/shared/list-pages.tsx";
import { useReadSaid } from "@/shared/read-said.ts";
import { RefusalLine } from "@/shared/refusal-outcome.tsx";

import { readRefused } from "./words.ts";

type Read = { readonly error: Error | ApiError | null; readonly isPending: boolean };

/** Mounts empty, so a read still loading or refused is heard as it fills. */
export function ReadSaid(properties: { readonly read: Read; readonly loading: string }) {
  const said = useReadSaid(properties.read);
  return (
    <div aria-live="polite" className="text-muted-foreground">
      {said.isPending ? <p className="mt-2">{properties.loading}</p> : null}
      {said.error === null ? null : (
        <p className="mt-2">
          <RefusalLine said={readRefused(said.error)} />
        </p>
      )}
    </div>
  );
}

/** What is typed narrows the rows already read, in the browser: the api is asked nothing more. */
export function useNarrowedRows<Row>(rows: readonly Row[], wordsOf: (row: Row) => string) {
  const [typed, setTyped] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const search = typed.trim();
  const shown = useMemo(() => {
    const sought = search.toLowerCase();
    return rows.filter((row) => wordsOf(row).toLowerCase().includes(sought));
  }, [rows, wordsOf, search]);
  const clear = () => {
    setTyped("");
  };
  return { typed, setTyped, clear, search, searchRef, shown };
}

type Narrowed = { readonly search: string; readonly shown: readonly unknown[] };

type CountWords = {
  readonly counted: (count: number) => string;
  readonly matching: (count: number, search: string) => string;
};

/** The list's one count: every row read, or the rows what was typed left. */
export const countOf = (words: CountWords, read: number, narrowed: Narrowed): string =>
  narrowed.search === ""
    ? words.counted(read)
    : words.matching(narrowed.shown.length, narrowed.search);

/** A table's body with no row: nothing matches what was typed, or `children` with nothing typed. */
export function NothingListed(properties: {
  readonly search: string;
  readonly noneMatch: (search: string) => string;
  readonly onClear: () => void;
  readonly searchRef: RefObject<HTMLInputElement | null>;
  readonly children: ReactNode;
}) {
  const { search } = properties;
  if (search === "") return properties.children;
  return (
    <ListState
      state={{
        kind: "emptied",
        words: properties.noneMatch(search),
        onClear: properties.onClear,
        focusAfterClear: properties.searchRef,
      }}
    />
  );
}
