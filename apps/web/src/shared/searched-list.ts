import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { z } from "zod";

import { useListAddress, type ListFields } from "@/shared/list-address.ts";
import { pageWithin } from "@/shared/list-pages.tsx";

/** Long enough to span a burst of typing, short enough to land before a reader moves on. */
const SETTLE_MS = 300;

/** A list searched from a box keeps its search in the address, as a word. */
type SearchedFields = ListFields & { readonly search: z.ZodCatch<z.ZodType<string>> };

/** The two keys this module reads whatever else the list holds; a list with no pages is on its first. */
const HELD = z.object({ search: z.string().catch(""), page: z.number().catch(1) });

/**
 * The box holds each key at once; a box bound to the address loses keys while the router catches
 * up. Leaving flushes first.
 */
const useSettledSearch = (held: string, write: (search: string) => void) => {
  const [draft, setDraft] = useState(held);
  const [seen, setSeen] = useState(held);
  const [sent, setSent] = useState<string>();

  // An address moved by Back or a link is what the box shows; the box's own write is ignored only
  // until it lands.
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

/** Read in render from the address, so Back and a reload come to the same rows. `clear` leaves `kept` alone. */
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

  /** A search still settling has not reached the address, so it shows its first page. */
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
