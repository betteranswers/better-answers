import { z } from "zod";

export const REQUESTS_LIST = "requests";

export const REQUESTS_FIELDS = {
  search: z.string().catch(""),
};
