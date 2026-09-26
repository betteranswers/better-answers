import type { z } from "zod";

import { act, declareActs, record } from "../audit/index.ts";
import { admit, declareAct, err, ok, ulid } from "../kernel/index.ts";
import type { AdmittedOf, Result, Role, UserId, UserPrincipal } from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import { endWorkspaceTokens } from "../workspaces/index.ts";
import { leavesNoAdmin, withMemberHeld, type HeldRefusal } from "./last-admin.ts";
import { memberKeyed } from "./memberships.ts";
import type { MemberRefusal } from "./vocabulary.ts";

const REMOVAL_ACTS = declareActs("people", {
  removed: act("people.member.removed", { role: "role" }),
});

export const removeMemberInput = memberKeyed;

export type RemoveMemberInput = z.output<typeof removeMemberInput> & {
  /** When the act happens: the person's tokens for this workspace issued before it end. */
  readonly at: Date;
};

const removeMemberAct = declareAct({
  admits: { role: "Admin", purposes: [] },
  input: removeMemberInput,
  refuses: ["role-forbids", "no-such-member", "last-admin", "changed-meanwhile"],
  effect: "write",
});

export type RemoveMemberRefusal =
  | MemberRefusal<"role-forbids" | "no-such-member" | "last-admin" | "changed-meanwhile">
  | Error;

export type MemberRemoved = {
  readonly personId: UserId;

  /** The role the membership held when it ended. */
  readonly role: Role;
};

const removedUnderTheLock = (
  admin: AdmittedOf<typeof removeMemberAct>,
  tx: Tx,
  input: RemoveMemberInput,
): Promise<Result<MemberRemoved, MemberRefusal<"last-admin"> | HeldRefusal | Error>> =>
  withMemberHeld(admin, tx, input.personId, async (held) => {
    if (leavesNoAdmin(held)) return err("last-admin");

    // The composite foreign key takes the person's group memberships here with the row.
    await tx.query("DELETE FROM member WHERE workspace_id = $1 AND user_id = $2", [
      admin.workspaceId,
      input.personId,
    ]);
    await endWorkspaceTokens(admin, tx, {
      workspaceId: admin.workspaceId,
      personId: input.personId,
      at: input.at,
    });
    await record(admin, tx, {
      id: ulid(),
      act: REMOVAL_ACTS.removed,
      subjectId: input.personId,
      detail: { role: held.role },
    });
    return ok({ personId: input.personId, role: held.role });
  });

/**
 * Ends the person's membership here and their tokens for this workspace; their sessions stand for
 * any other workspace and are refused here. Refuses `last-admin` for the workspace's one Admin; an
 * Admin may remove themself while another remains.
 */
export const removeMember = async (
  principal: UserPrincipal,
  tx: Tx,
  input: RemoveMemberInput,
): Promise<Result<MemberRemoved, RemoveMemberRefusal>> => {
  const admitted = admit(removeMemberAct, principal, input);
  if (!admitted.ok) return err(admitted.error);
  return removedUnderTheLock(admitted.value, tx, input);
};
