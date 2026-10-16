import { z } from "zod";

import { ULID } from "@better-answers/schema/ulid";

import { PAGE_NUMBER } from "@/shared/list-address.ts";
import { CONTROL_CENTRE, detailAt, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import type { Role } from "./people-api.ts";

const PEOPLE = menuGroupIn(CONTROL_CENTRE, "people");

export const MEMBERS_PAGE = pageNamed(PEOPLE, "Members");

export const GROUPS_PATH = pageNamed(PEOPLE, "Groups").path;

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

export const PERSON_ID = z.string().regex(ULID);

export const memberPageOf = (personId: string): string => detailAt(MEMBERS_PAGE, personId);

export const membersAt = (query: string | undefined): string =>
  `${MEMBERS_PAGE.path}${query ?? ""}`;

const OPENED_AT = ["member", "role", "groups", "credentials", "flag", "removal"] as const;

export type OpenedAt = (typeof OPENED_AT)[number];

export type Opening = { readonly openedAt: OpenedAt; readonly membersQuery: string };

export const OPENING = z.object({
  openedAt: z.enum(OPENED_AT).optional().catch(undefined),
  membersQuery: z.string().optional().catch(undefined),
});

export type Removed = { readonly personId: string; readonly name: string };

export const RETURNED_FROM_A_REMOVAL = z.object({
  removed: z.object({ personId: z.string(), name: z.string() }),
});
