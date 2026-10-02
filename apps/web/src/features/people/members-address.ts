import { useEffect, useEffectEvent, useState } from "react";
import { z } from "zod";

import type { Here } from "@/shared/address-ask.ts";
import { PAGE_NUMBER } from "@/shared/list-address.ts";

import type { Role } from "./people-api.ts";

/** Members, Invitations and Requests share one address, so each tab's keys carry its prefix. */
export const MEMBERS_LIST = "members";

const ROLE_FILTERS = ["Admin", "Editor", "Viewer"] as const satisfies readonly Role[];

const SORTS = ["person", "-person", "role", "-role", "joined", "-joined"] as const;

export const MEMBERS_FIELDS = {
  search: z.string().catch(""),
  role: z.enum(ROLE_FILTERS).optional().catch(undefined),
  group: z.string().optional().catch(undefined),
  sort: z.enum(SORTS).optional().catch(undefined),
  page: PAGE_NUMBER,
};

type Sorted = { readonly id: string; readonly desc: boolean };

export const sortedOf = (sort: (typeof SORTS)[number] | undefined): Sorted | undefined =>
  sort === undefined ? undefined : { id: sort.replace(/^-/, ""), desc: sort.startsWith("-") };

export const sortOf = (sorted: Sorted): (typeof SORTS)[number] | undefined =>
  SORTS.find((sort) => sort === `${sorted.desc ? "-" : ""}${sorted.id}`);

/** Found by their address alone, since the list's other narrowing could hide them. */
export const membersSeeking = (here: Here, path: string, address: string): string => {
  const kept = [...new URLSearchParams(here.pathname === path ? here.searchStr : "")].filter(
    ([key]) => !key.startsWith(`${MEMBERS_LIST}.`),
  );
  return `${path}?${new URLSearchParams([...kept, [`${MEMBERS_LIST}.search`, address]]).toString()}`;
};

/** Long enough to span a burst of typing, short enough to land before a reader moves on. */
const SETTLE_MS = 300;

/** The box holds each key at once; a box bound to the address loses keys while the router catches up. */
export const useSettledSearch = (held: string, write: (search: string) => void) => {
  const [draft, setDraft] = useState(held);
  const [seen, setSeen] = useState(held);
  const [sent, setSent] = useState<string>();

  // An address moved by Back or a link, not by this box, is what the box shows.
  if (held !== seen) {
    setSeen(held);
    if (held !== sent) setDraft(held);
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

  return [draft, setDraft] as const;
};
