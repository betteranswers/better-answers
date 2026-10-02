import { INVITATION_WAITING_STATUS } from "@better-answers/schema";

import type { AdminUserPrincipal } from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import type { MemberRefusal } from "./vocabulary.ts";

export const OFF_TESTING_DOMAIN =
  "off-testing-domain" satisfies MemberRefusal<"off-testing-domain">;

const MARKED = "SELECT testing_domain FROM test_workspace_mark WHERE workspace_id = $1";

/** Undefined for an unmarked workspace, which invites any address. */
export const testingDomainOf = async (
  admin: AdminUserPrincipal,
  tx: Tx,
): Promise<string | undefined> => {
  const marked = await tx.query<{ testing_domain: string }>(MARKED, [admin.workspaceId]);
  return marked.rows[0]?.testing_domain;
};

/** The part after the last `@`, as the mark holds it, so a subdomain is another domain. */
export const isOffDomain = (domain: string | undefined, address: string): boolean =>
  domain !== undefined && address.slice(address.lastIndexOf("@") + 1).toLowerCase() !== domain;

const WAITING_ADDRESSES = `SELECT id, lower(email) AS address FROM invitation
                            WHERE workspace_id = $1 AND id = ANY($2::text[]) AND status = $3
                            ORDER BY id`;

/** Read unlocked, so a resend still takes its counters before any invitation row it holds. */
export const invitationsOffDomain = async (
  admin: AdminUserPrincipal,
  tx: Tx,
  invitationIds: readonly string[],
): Promise<readonly string[]> => {
  const domain = await testingDomainOf(admin, tx);
  if (domain === undefined) return [];
  const waiting = await tx.query<{ id: string; address: string }>(WAITING_ADDRESSES, [
    admin.workspaceId,
    invitationIds,
    INVITATION_WAITING_STATUS,
  ]);
  return waiting.rows.filter((row) => isOffDomain(domain, row.address)).map((row) => row.id);
};
