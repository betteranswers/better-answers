import { z } from "zod";

/** The Groups page has the address to itself, so its list's keys carry their own name alone. */
export const GROUPS_LIST = "groups";

/** A workspace holds few groups, so the list has no pages to hold. */
export const GROUPS_FIELDS = {
  search: z.string().catch(""),
};
