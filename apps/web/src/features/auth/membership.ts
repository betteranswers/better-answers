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
 * carrying its name — `no-session`, `no-active-workspace`, `not-a-member`,
 * `credentials-revoked`, `role-disagrees`, `role-unknown`, `malformed-claims`
 * (`apps/api/src/trpc/base.ts`) — and the shell reads the name rather than the code,
 * because two of them mean "ask a different question" and the rest mean "sign in again".
 */
type Refused = {
  readonly data?: { readonly code?: string } | null | undefined;
  readonly message: string;
};

export const refusalOf = (error: Refused | null): string | undefined =>
  error !== null && error.data?.code === "UNAUTHORIZED" ? error.message : undefined;

/** The one refusal a person can answer without signing in again: they have not picked yet. */
export const NEEDS_A_PICK = "no-active-workspace";
