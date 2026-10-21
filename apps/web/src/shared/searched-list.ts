import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { z } from "zod";

import { useListAddress, type ListFields, type searchText } from "@/shared/list-address.ts";
import { pageWithin } from "@/shared/list-pages.tsx";

const SETTLE_MS = 300;

type SearchedFields = ListFields & { readonly search: ReturnType<typeof searchText> };

const HELD = z.object({ search: z.string().catch(""), page: z.number().catch(1) });

const useSettledSearch = (held: string, write: (search: string) => void) => {
  const [draft, setDraft] = useState(held);
  const [seen, setSeen] = useState(held);
  const [sent, setSent] = useState<string>();

  if (held !== seen) {
    setSeen(held);
    if (held === sent) setSent(undefined);
    else setDraft(held);
  }

  const send = useEffectEvent((search: string) => {
    setSent(search);
    write(search);
  });

  useEffect(() => {
    if (draft === held) return;
    const settling = setTimeout(() => {
      send(draft);
    }, SETTLE_MS);
    return () => {
      clearTimeout(settling);
    };
  }, [draft, held]);

  const flush = () => {
    if (draft === held) return;
    setSent(draft);
    write(draft);
  };

  return [draft, setDraft, flush] as const;
};

export const useSearchedList = <Fields extends SearchedFields>(
  prefix: string,
  fields: Fields,
  kept: readonly (keyof Fields & string)[] = [],
) => {
  const { state, write, writeHeld } = useListAddress(prefix, fields);
  const held = useMemo(() => HELD.parse(state), [state]);
  const paged = Object.hasOwn(fields, "page");
  const [search, setSearch, flush] = useSettledSearch(held.search, (settled) => {
    writeHeld(
      paged
        ? [
            ["search", settled],
            ["page", 1],
          ]
        : [["search", settled]],
    );
  });

  const pageIndex = (pageSize: number, total: number): number =>
    pageWithin(search === held.search ? held.page - 1 : 0, pageSize, total);

  const clear = () => {
    const keptHere = new Set<string>(kept);
    setSearch("");
    writeHeld(
      Object.keys(fields)
        .filter((field) => !keptHere.has(field))
        .map((field) => [field, undefined] as const),
    );
  };

  return { state, write, search, setSearch, flush, pageIndex, clear };
};
