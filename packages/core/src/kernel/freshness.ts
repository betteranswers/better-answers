import type { CarriesAConfirmation } from "./principal.ts";
import { err, ok, type Result } from "./result.ts";
import type { KernelRefusal } from "./vocabulary.ts";

export type FreshnessRefusal = KernelRefusal<"confirmation-too-old">;

/** A confirmation reaches a high-impact act for this long after it was made. */
const FRESH_FOR_MS = 60 * 60 * 1000;

/**
 * Judged against the action's own instant rather than a clock read here, so a test can hold it
 * still. A stamp in the future counts as stale, and so does none: a caller whose claims name no
 * session, such as a bearer, holds no confirmation to act on.
 */
export const requireFreshConfirmation = <Confirmed extends CarriesAConfirmation>(
  judged: Confirmed,
  at: Date,
): Result<Confirmed, FreshnessRefusal> => {
  const confirmedAtMs = judged.secondFactorConfirmedAtMs;
  const fresh =
    confirmedAtMs !== null &&
    confirmedAtMs <= at.getTime() &&
    at.getTime() - confirmedAtMs <= FRESH_FOR_MS;
  return fresh ? ok(judged) : err("confirmation-too-old");
};
