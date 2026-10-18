import { z } from "zod";

export const GROUPS_LIST = "groups";

export const GROUPS_FIELDS = {
  search: z.string().catch(""),
};
