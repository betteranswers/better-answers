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

const PERSON_ID = boundarySchemas.user.select.shape.id;

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

type HeldRow = { readonly personId: UserId; readonly role: Role };

type HeldSet = {
  /** Each ticked person who is a member here, in person id order. */
  readonly rows: readonly HeldRow[];

  /** Every Admin here, ticked or not, held under the same lock. */
  readonly admins: readonly UserId[];
};

/** One statement, in person id order, so two acts holding overlapping sets take them alike. */
const HELD_MEMBERS = `SELECT user_id, role FROM member
                       WHERE workspace_id = $1 AND user_id = ANY($2::text[])
                       ORDER BY user_id FOR UPDATE`;

const setHeld = async (admin: AnAdmin, tx: Tx, personIds: readonly UserId[]): Promise<HeldSet> => {
  const admins = await tx.query<{ user_id: string }>(HELD_ADMINS, [admin.workspaceId, ADMIN]);
  const held = await tx.query<{ user_id: string; role: string }>(HELD_MEMBERS, [
    admin.workspaceId,
    personIds,
  ]);
  return {
    rows: held.rows.map((row) => ({
      personId: PERSON_ID.parse(row.user_id),
      role: ROLE.parse(row.role),
    })),
    admins: admins.rows.map((row) => PERSON_ID.parse(row.user_id)),
  };
};

/**
 * As `withMemberHeld`, over a set: every Admin row, then the ticked rows. A deadlock anywhere in
 * `work`, its writes included, answers `changed-meanwhile`.
 */
export const withMembersHeld = async <Value, Refusal>(
  admin: AnAdmin,
  tx: Tx,
  personIds: readonly UserId[],
  work: (held: HeldSet) => Promise<Result<Value, Refusal>>,
): Promise<Result<Value, Refusal | KernelRefusal<"changed-meanwhile"> | Error>> => {
  const done = await attempt(async () => work(await setHeld(admin, tx, personIds)));
  return done.ok ? done.value : err(refusalOfDeadlock(done.error));
};

/** The Admins the workspace keeps once every one of `losing` has lost the role. */
const adminsLeftAfter = (held: HeldSet, losing: readonly UserId[]): number =>
  held.admins.filter((personId) => !losing.includes(personId)).length;

/**
 * Every Admin among `leaving` when, with all of them gone, the workspace would keep none; nobody
 * otherwise, so a refusal names each Admin ticked, never whichever came last.
 */
export const lastAdminsAmong = (held: HeldSet, leaving: readonly HeldRow[]): readonly UserId[] => {
  const losing = leaving.filter((row) => row.role === ADMIN).map((row) => row.personId);
  return adminsLeftAfter(held, losing) < 1 ? losing : [];
};
