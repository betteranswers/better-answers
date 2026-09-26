import { boundarySchemas } from "@better-answers/schema";

import {
  attempt,
  err,
  ok,
  type KernelRefusal,
  type Result,
  type Role,
  type UserId,
  type UserPrincipal,
} from "../kernel/index.ts";
import { refusalOfDeadlock, type Tx } from "../store/postgres/index.ts";
import type { MemberRefusal } from "./vocabulary.ts";

const ROLE = boundarySchemas.member.select.shape.role;

const ADMIN = "Admin" satisfies Role;

/** What an Admin-only act's admission hands on, so the step judges no one. */
type AnAdmin = UserPrincipal & { readonly role: typeof ADMIN };

export type HeldMember = {
  readonly role: Role;

  /** Counted under the same lock, so it cannot move before the act commits. */
  readonly admins: number;
};

/**
 * Held until commit, so of two acts that would each leave one Admin, the second counts what the
 * first left.
 */
const HELD_ADMINS = `SELECT user_id FROM member WHERE workspace_id = $1 AND role = $2
                      ORDER BY user_id FOR UPDATE`;

const HELD_MEMBER = "SELECT role FROM member WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE";

const memberHeld = async (
  admin: AnAdmin,
  tx: Tx,
  personId: UserId,
): Promise<Result<HeldMember, MemberRefusal<"no-such-member">>> => {
  const admins = await tx.query(HELD_ADMINS, [admin.workspaceId, ADMIN]);
  const held = await tx.query<{ role: string }>(HELD_MEMBER, [admin.workspaceId, personId]);
  const row = held.rows[0];
  if (row === undefined) return err("no-such-member");
  return ok({ role: ROLE.parse(row.role), admins: admins.rows.length });
};

export type HeldRefusal = MemberRefusal<"no-such-member"> | KernelRefusal<"changed-meanwhile">;

/**
 * Runs `work` on the member once every Admin row of the workspace, then theirs, is held until
 * commit. The transport already holds the caller's own row, so two Admins acting on each other can
 * deadlock; Postgres aborts one, which answers `changed-meanwhile`.
 */
export const withMemberHeld = async <Value, Refusal>(
  admin: AnAdmin,
  tx: Tx,
  personId: UserId,
  work: (held: HeldMember) => Promise<Result<Value, Refusal>>,
): Promise<Result<Value, Refusal | HeldRefusal | Error>> => {
  const done = await attempt(async (): Promise<Result<Value, Refusal | HeldRefusal>> => {
    const held = await memberHeld(admin, tx, personId);
    return held.ok ? work(held.value) : held;
  });
  return done.ok ? done.value : err(refusalOfDeadlock(done.error));
};

/** The workspace's one Admin may neither lose the role nor leave. */
export const leavesNoAdmin = (held: HeldMember): boolean => held.role === ADMIN && held.admins <= 1;
