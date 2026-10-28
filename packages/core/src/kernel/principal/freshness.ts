import { err, ok, type Result } from "../result.ts";
import type { KernelRefusal } from "../vocabulary.ts";
import type { CarriesAConfirmation } from "./principal.ts";

export type FreshnessRefusal = KernelRefusal<"confirmation-too-old">;

const FRESH_FOR_MS = 60 * 60 * 1000;

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
