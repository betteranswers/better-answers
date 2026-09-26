import { boundarySchemas } from "@better-answers/schema";
import { z } from "zod";

import {
  admit,
  attempt,
  declareAct,
  err,
  ok,
  type RefusalOf,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import type { MemberRefusal } from "./vocabulary.ts";

const listMembersAct = declareAct({
  admits: { role: "Admin", purposes: [] },
  input: z.object({}),
  refuses: ["role-forbids"],
  effect: "read",
});

export type ListMembersRefusal = MemberRefusal<RefusalOf<typeof listMembersAct>> | Error;

const LISTED_ROW = z.object({
  personId: boundarySchemas.user.select.shape.id,
  displayName: boundarySchemas.user.select.shape.name,
  address: boundarySchemas.user.select.shape.email,
  role: boundarySchemas.member.select.shape.role,
  joinedAt: boundarySchemas.member.select.shape.createdAt,
  credentialsRevokedAt: boundarySchemas.member.select.shape.credentialsRevokedAt,
  groups: z.array(
    z.object({
      groupId: boundarySchemas.group.select.shape.id,
      name: boundarySchemas.group.select.shape.name,
    }),
  ),
});

type ListedRow = z.output<typeof LISTED_ROW>;

export type ListedMember = Omit<ListedRow, "joinedAt" | "credentialsRevokedAt"> & {
  /** An ISO instant, which is what a `Date` becomes on the wire anyway. */
  readonly joinedAt: string;

  /** A credential issued before it is refused here; null where no Admin here has revoked any. */
  readonly credentialsRevokedAt: string | null;
};

const MEMBERS = `SELECT u.id AS "personId", u.name AS "displayName", u.email AS address, m.role,
            m.created_at AS "joinedAt", m.credentials_revoked_at AS "credentialsRevokedAt",
            COALESCE(
              json_agg(json_build_object('groupId', g.id, 'name', g.name) ORDER BY g.name, g.id)
                FILTER (WHERE g.id IS NOT NULL),
              '[]'
            ) AS groups
       FROM member m
       JOIN "user" u ON u.id = m.user_id
       LEFT JOIN group_member gm ON gm.workspace_id = m.workspace_id AND gm.user_id = m.user_id
       LEFT JOIN "group" g ON g.workspace_id = gm.workspace_id AND g.id = gm.group_id
      WHERE m.workspace_id = $1
      GROUP BY u.id, u.name, u.email, m.role, m.created_at, m.credentials_revoked_at
      ORDER BY lower(u.name), lower(u.email), u.id`;

/**
 * In display-name order, then by address. A member is named by their person id: the member row's
 * own key names nothing outside its table.
 */
export const listMembers = async (
  principal: UserPrincipal,
  tx: Tx,
): Promise<Result<readonly ListedMember[], ListMembersRefusal>> => {
  const admitted = admit(listMembersAct, principal, {});
  if (!admitted.ok) return err(admitted.error);

  // The parse brands the ids; a row it throws on fails the read like the query would.
  const listed = await attempt(async () =>
    z.array(LISTED_ROW).parse((await tx.query(MEMBERS, [admitted.value.workspaceId])).rows),
  );
  if (!listed.ok) return err(listed.error);

  return ok(
    listed.value.map((row) => ({
      ...row,
      joinedAt: row.joinedAt.toISOString(),
      credentialsRevokedAt: row.credentialsRevokedAt?.toISOString() ?? null,
    })),
  );
};
