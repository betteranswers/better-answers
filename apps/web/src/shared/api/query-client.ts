import { QueryClient } from "@tanstack/react-query";

/**
 * Server state for the whole app. One per mount rather than one per module, so a second
 * render in a test never inherits the first one's cache.
 *
 * `retry: false` on queries because every refusal this api returns is a decision, not a
 * blip — no session, no active workspace, not a member (`apps/api/src/trpc/base.ts`) — and
 * retrying one three times only delays the screen that has to say so (`[UX2]`).
 */
export const createQueryClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });
