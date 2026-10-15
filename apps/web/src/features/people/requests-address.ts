import { z } from "zod";

/** Members' keys carry `members`, so the Requests tab's keys carry their own prefix. */
export const REQUESTS_LIST = "requests";

/** Requests are answered one at a time from a short list, so the list has no pages to hold. */
export const REQUESTS_FIELDS = {
  search: z.string().catch(""),
};
