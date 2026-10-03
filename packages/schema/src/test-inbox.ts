import { z } from "zod";

/**
 * The list keeps the shape of Resend's receiving API, which the journeys' reader was written
 * against, so `to` is an array.
 */
const TEST_INBOX_LISTED = z.object({
  id: z.string(),
  to: z.array(z.string()),
  from: z.string(),
  created_at: z.iso.datetime(),
  subject: z.string(),
});

/** The test inbox's list: newest first, and `has_more` while older messages remain. */
export const TEST_INBOX_PAGE = z.object({
  object: z.literal("list").optional(),
  has_more: z.boolean(),
  data: z.array(TEST_INBOX_LISTED),
});

/** One message with its raw bytes in base64, so the reader can verify their signature itself. */
export const TEST_INBOX_MESSAGE = TEST_INBOX_LISTED.extend({ raw: z.base64() });

export type TestInboxListed = z.infer<typeof TEST_INBOX_LISTED>;

export type TestInboxPage = z.infer<typeof TEST_INBOX_PAGE>;

export type TestInboxMessage = z.infer<typeof TEST_INBOX_MESSAGE>;
