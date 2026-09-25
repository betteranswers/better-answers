import { boundarySchemas } from "@better-answers/schema";
import { z } from "zod";

import { act, declareActs, record } from "../audit/index.ts";
import {
  admit,
  attempt,
  declareAct,
  err,
  ok,
  type AdmittedOf,
  type Result,
  type Role,
  type UserId,
  type UserPrincipal,
  ulid,
} from "../kernel/index.ts";
import { refusalOfDeadlock, type Tx } from "../store/postgres/index.ts";
import type { MemberRefusal } from "./vocabulary.ts";

const ROLE_ACTS = declareActs("people", {
  roleChanged: act("people.member.role_changed", { previousRole: "role", role: "role" }),
});

const ROLE = boundarySchemas.member.select.shape.role;

const ADMIN = "Admin" satisfies Role;

/** The role is any text, so a role outside the three reaches the act and is refused in its word. */
export const changeRoleInput = z.object({
  personId: boundarySchemas.user.select.shape.id,
  role: z.string(),
});

export type ChangeRoleInput = z.output<typeof changeRoleInput>;

const changeRoleAct = declareAct({
  admits: { role: "Admin", purposes: [] },
  input: changeRoleInput,
  refuses: ["role-forbids", "no-such-role", "no-such-member", "last-admin", "changed-meanwhile"],
  effect: "write",
});

export type ChangeRoleRefusal =
  | MemberRefusal<
      "role-forbids" | "no-such-role" | "no-such-member" | "last-admin" | "changed-meanwhile"
    >
  | Error;

export type RoleChanged = {
  readonly personId: UserId;
  readonly previousRole: Role;
  readonly role: Role;
};

type Asked = { readonly personId: UserId; readonly role: Role };

/**
 * Held until commit, so of two acts that would each leave one Admin, the second counts what the
 * first left.
 */
const HELD_ADMINS = `SELECT user_id FROM member WHERE workspace_id = $1 AND role = $2
                      ORDER BY user_id FOR UPDATE`;

const HELD_MEMBER = "SELECT role FROM member WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE";

const roleSetUnderTheLock = async (
  admin: AdmittedOf<typeof changeRoleAct>,
  tx: Tx,
  asked: Asked,
): Promise<Result<RoleChanged, MemberRefusal<"no-such-member" | "last-admin">>> => {
  const admins = await tx.query(HELD_ADMINS, [admin.workspaceId, ADMIN]);
  const held = await tx.query<{ role: string }>(HELD_MEMBER, [admin.workspaceId, asked.personId]);
  const row = held.rows[0];
  if (row === undefined) return err("no-such-member");

  const changed: RoleChanged = { ...asked, previousRole: ROLE.parse(row.role) };
  if (changed.previousRole === changed.role) return ok(changed);
  if (changed.previousRole === ADMIN && admins.rows.length <= 1) return err("last-admin");

  await tx.query("UPDATE member SET role = $3 WHERE workspace_id = $1 AND user_id = $2", [
    admin.workspaceId,
    asked.personId,
    asked.role,
  ]);
  await record(admin, tx, {
    id: ulid(),
    act: ROLE_ACTS.roleChanged,
    subjectId: asked.personId,
    detail: { previousRole: changed.previousRole, role: changed.role },
  });
  return ok(changed);
};

/**
 * Refuses `last-admin` for a change that would leave the workspace with no Admin; an Admin may
 * demote themself while another remains. Roles are read afresh on every call, so the change holds
 * from the member's next request. Asking for the role already held writes nothing.
 */
export const changeRole = async (
  principal: UserPrincipal,
  tx: Tx,
  input: ChangeRoleInput,
): Promise<Result<RoleChanged, ChangeRoleRefusal>> => {
  const admitted = admit(changeRoleAct, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const role = ROLE.safeParse(input.role);
  if (!role.success) return err("no-such-role");

  const set = await attempt(() =>
    roleSetUnderTheLock(admitted.value, tx, { personId: input.personId, role: role.data }),
  );
  return set.ok ? set.value : err(refusalOfDeadlock(set.error));
};
