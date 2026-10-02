import { useEffect, useEffectEvent, useState } from "react";
import { z } from "zod";

import { ULID } from "@better-answers/schema/ulid";

import { PAGE_NUMBER } from "@/shared/list-address.ts";
import { CONTROL_CENTRE, detailAt, groupIn, screenNamed } from "@/shared/navigation.ts";

import type { Role } from "./people-api.ts";

const MEMBERS = screenNamed(groupIn(CONTROL_CENTRE, "people"), "Members");

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

/** A person's id as the api mints it. Anything else names no one, so it is never asked about. */
export const PERSON_ID = z.string().regex(ULID);

export const memberPageOf = (personId: string): string => detailAt(MEMBERS, personId);

/** Members with the query its reader left it at, so a return finds the same rows. */
export const membersAt = (query: string | undefined): string => `${MEMBERS.path}${query ?? ""}`;

const OPENED_AT = ["member", "role", "groups", "credentials", "flag", "removal"] as const;

/** Where focus lands as a member's page opens: on who they are, or on one act's control. */
export type OpenedAt = (typeof OPENED_AT)[number];

/** Asked of a member's page through its history entry: a section has no address of its own. */
export type Opening = { readonly openedAt: OpenedAt; readonly membersQuery: string };

export const OPENING = z.object({
  openedAt: z.enum(OPENED_AT).optional().catch(undefined),
  membersQuery: z.string().optional().catch(undefined),
});

/** Who was removed from their page, carried by the Members entry the removal returns to. */
export type Removed = { readonly personId: string; readonly name: string };

export const RETURNED_FROM_A_REMOVAL = z.object({
  removed: z.object({ personId: z.string(), name: z.string() }),
});

/** Long enough to span a burst of typing, short enough to land before a reader moves on. */
const SETTLE_MS = 300;

/**
 * The box holds each key at once; a box bound to the address loses keys while the router catches
 * up. Leaving flushes first.
 */
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

  const flush = () => {
    if (draft === held) return;
    setSent(draft);
    write(draft);
  };

  return [draft, setDraft, flush] as const;
};
