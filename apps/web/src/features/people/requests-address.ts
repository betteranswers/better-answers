import { z } from "zod";

export const REQUESTS_LIST = "requests";

/** Requests are answered one at a time from a short list, so the list has no pages to hold. */
export const REQUESTS_FIELDS = {
  search: z.string().catch(""),
};
