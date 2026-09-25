import type { OperatorPrincipal } from "./principal.ts";
import { err, ok, type Result } from "./result.ts";
import type { KernelRefusal } from "./vocabulary.ts";

export type FreshnessRefusal = KernelRefusal<"sign-in-too-old">;

/** A session cookie stolen later than this after its sign-in reaches none of the operator's writes. */
const SIGN_IN_FRESH_FOR_MS = 3_600_000;

/** Judged against the act's own instant rather than a clock read here, so a test can hold it still. */
export const requireFreshSignIn = (
  operator: OperatorPrincipal,
  at: Date,
): Result<OperatorPrincipal, FreshnessRefusal> =>
  at.getTime() - operator.credentialIssuedAtMs > SIGN_IN_FRESH_FOR_MS
    ? err("sign-in-too-old")
    : ok(operator);
