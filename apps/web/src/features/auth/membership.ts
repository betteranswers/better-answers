import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "@/shared/api/trpc.ts";

/**
 * Who the platform thinks is reading: the workspace, the person and their role, answered
 * by `session.membership` through the same resolver every other procedure crosses. The
 * shell asks this rather than reading the session object, because the role is the member
 * row's and is read in the transaction that authorises the read — never guessed from a
 * claim, and never defaulted (`[SEC2]`, ADR 0018).
 *
 * The declaration lives here, in the feature that owns identity, and the client it is
 * issued through lives in `shared/` (bulletproof-react's api layer; ADR 0006's amendment).
 */
export const useMembership = () => {
  const trpc = useTRPC();
  return useQuery(trpc.session.membership.queryOptions());
};

/**
 * Why the platform refused, in its own word. Every refusal arrives as `UNAUTHORIZED`
 * carrying its name, and this procedure can answer nine of them:
 *
 * - the transport's two, before the resolver — `no-session`, `no-active-workspace`;
 * - the resolver's five — `not-a-member`, `credentials-revoked`, `role-disagrees`,
 *   `role-unknown`, `malformed-claims`;
 * - and this read's own two — `no-such-workspace`, `no-such-person`, a session pointing
 *   at rows that no longer exist, which to a reader is a session that has ended.
 *
 * The shell reads the name rather than the code, because exactly one of the nine —
 * `no-active-workspace` — means "answer a question", and the other eight mean "sign in
 * again". A name it does not know is treated as the eight, which is the safe way round.
 */
type Refused = {
  readonly data?: { readonly code?: string } | null | undefined;
  readonly message: string;
};

export const refusalOf = (error: Refused | null): string | undefined =>
  error !== null && error.data?.code === "UNAUTHORIZED" ? error.message : undefined;

/** The one refusal a person can answer without signing in again: they have not picked yet. */
export const NEEDS_A_PICK = "no-active-workspace";
