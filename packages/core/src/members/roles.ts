import { z } from "zod";

import { boundarySchemas } from "@better-answers/schema";

import { action, declareActions, record } from "../audit/index.ts";
import {
  admit,
  declareAction,
  err,
  ok,
  type AdminUserPrincipal,
  type AdmittedOf,
  type PlatformPrincipal,
  type Result,
  type Role,
  type UserId,
  type UserPrincipal,
  type WorkspaceId,
  ulid,
} from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import { promoting } from "../workspaces/index.ts";
import { leavesNoAdmin, withMemberHeld, type HeldRefusal } from "./last-admin.ts";
import { memberKeyed } from "./member-list.ts";
import type { MemberRefusal } from "./vocabulary.ts";

const ROLE_ACTIONS = declareActions("people", {
  roleChanged: action("people.member.role_changed", { previousRole: "role", role: "role" }),
});

const ROLE = boundarySchemas.member.select.shape.role;

/** The role is any text, so a role outside the three reaches the action and is refused in its word. */
export const changeRoleInput = memberKeyed.extend({ role: z.string() });

export type ChangeRoleInput = z.output<typeof changeRoleInput>;

const changeRoleAction = declareAction({
  admits: { role: "Admin", purposes: [] },
  input: changeRoleInput,
  refuses: ["role-forbids", "no-such-role", "no-such-member", "last-admin", "changed-meanwhile"],
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

/** As changed, and whether the move made them hold a second factor for the first time. */
export type RoleMoved = RoleChanged & { readonly promoted: boolean };

type Asked = { readonly personId: UserId; readonly role: Role };

const roleWrittenBy = async (
  actor: AdminUserPrincipal | PlatformPrincipal,
  tx: Tx,
  workspaceId: WorkspaceId,
  changed: RoleChanged,
  batchId: string | undefined,
): Promise<boolean> => {
  const promoted = changed.role === "Admin" && (await promoting(tx, changed.personId));
  await tx.query("UPDATE member SET role = $3 WHERE workspace_id = $1 AND user_id = $2", [
    workspaceId,
    changed.personId,
    changed.role,
  ]);
  await record(actor, tx, {
    id: ulid(),
    action: ROLE_ACTIONS.roleChanged,
    subjectId: changed.personId,
    detail: { previousRole: changed.previousRole, role: changed.role },
    batchId,
  });
  return promoted;
};

/**
 * A step on a member row its action holds: the role moves, and its audit event lands in `batchId`.
 * True when the move made the person hold a second factor for the first time.
 */
export const roleWritten = (
  admin: AdminUserPrincipal,
  tx: Tx,
  changed: RoleChanged,
  batchId?: string,
): Promise<boolean> => roleWrittenBy(admin, tx, admin.workspaceId, changed, batchId);

const ROLE_HELD = "SELECT role FROM member WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE";

/**
 * As `roleWritten`, by the platform under `workspaceId`'s scope, judging no last Admin. It holds
 * the row itself, so a role moved or a member removed since the caller read records nothing stale.
 */
export const roleWrittenByPlatform = async (
  platform: PlatformPrincipal,
  tx: Tx,
  workspaceId: WorkspaceId,
  asked: Pick<RoleChanged, "personId" | "role">,
  batchId?: string,
): Promise<boolean> => {
  const held = await tx.query<{ role: string }>(ROLE_HELD, [workspaceId, asked.personId]);
  const row = held.rows[0];
  if (row === undefined) return false;
  const previousRole = ROLE.parse(row.role);
  if (previousRole === asked.role) return false;
  await roleWrittenBy(platform, tx, workspaceId, { ...asked, previousRole }, batchId);
  return true;
};

const roleSetUnderTheLock = (
  admin: AdmittedOf<typeof changeRoleAction>,
  tx: Tx,
  asked: Asked,
): Promise<Result<RoleMoved, MemberRefusal<"last-admin"> | HeldRefusal | Error>> =>
  withMemberHeld(admin, tx, asked.personId, async (held) => {
    const changed: RoleChanged = { ...asked, previousRole: held.role };
    if (changed.previousRole === changed.role) return ok({ ...changed, promoted: false });
    if (leavesNoAdmin(held)) return err("last-admin");

    return ok({ ...changed, promoted: await roleWritten(admin, tx, changed) });
  });

/**
 * Refuses `last-admin` for a change that would leave the workspace with no Admin; an Admin may
 * demote themself while another remains. Roles are read afresh on every call, so the change holds
 * from the member's next request. Asking for the role already held writes nothing.
 */
export const changeRole = async (
  principal: UserPrincipal,
  tx: Tx,
  input: ChangeRoleInput,
): Promise<Result<RoleMoved, ChangeRoleRefusal>> => {
  const admitted = admit(changeRoleAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const role = ROLE.safeParse(input.role);
  if (!role.success) return err("no-such-role");

  return roleSetUnderTheLock(admitted.value, tx, { personId: input.personId, role: role.data });
};
