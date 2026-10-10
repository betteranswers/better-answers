import { z } from "zod";

import { boundarySchemas } from "@better-answers/schema";

import { action, declareActions, record } from "../audit/index.ts";
import {
  admit,
  ADMIN_ALONE,
  attempt,
  declareAction,
  err,
  ok,
  type AdmittedOf,
  type RefusalOf,
  type Result,
  type UserId,
  type UserPrincipal,
  ulid,
} from "../kernel/index.ts";
import { refusalOfDeadlock, type Tx } from "../store/postgres/index.ts";
import { endWorkspaceTokens, recordGrantsEndedHere } from "../workspaces/index.ts";
import type { MemberRefusal } from "./vocabulary.ts";

const REVOCATION_ACTIONS = declareActions("people", {
  credentialsRevoked: action("people.member.credentials_revoked", { grants: "grants" }),
});

export const endEverySignInAndTokenHereInput = z.object({
  personId: boundarySchemas.user.select.shape.id,
});

export type EndEverySignInAndTokenHereInput = z.output<typeof endEverySignInAndTokenHereInput> & {
  /** When the action happens: every credential the member was issued before it is refused here. */
  readonly at: Date;
};

const endEverySignInAndTokenHereAction = declareAction({
  admits: ADMIN_ALONE,
  input: endEverySignInAndTokenHereInput,
  refuses: ["role-forbids", "no-such-member", "changed-meanwhile"],
});

export type EndEverySignInAndTokenHereRefusal =
  | MemberRefusal<RefusalOf<typeof endEverySignInAndTokenHereAction>>
  | Error;

export type CredentialsRevokedHere = {
  readonly personId: UserId;

  /** Later than the `at` asked for where an earlier revocation here already held a later one. */
  readonly revokedAt: string;
};

const HELD_INSTANT = `UPDATE member
                         SET credentials_revoked_at = GREATEST(COALESCE(credentials_revoked_at, $3), $3)
                       WHERE workspace_id = $1 AND user_id = $2
                   RETURNING credentials_revoked_at AS at`;

const revokedHere = async (
  admin: AdmittedOf<typeof endEverySignInAndTokenHereAction>,
  tx: Tx,
  asked: EndEverySignInAndTokenHereInput,
): Promise<Result<CredentialsRevokedHere, MemberRefusal<"no-such-member">>> => {
  const held = await tx.query<{ at: Date }>(HELD_INSTANT, [
    admin.workspaceId,
    asked.personId,
    asked.at,
  ]);
  const at = held.rows[0]?.at;
  if (at === undefined) return err("no-such-member");

  const { grants } = await endWorkspaceTokens(admin, tx, {
    workspaceId: admin.workspaceId,
    personId: asked.personId,
    at,
  });
  await record(admin, tx, {
    id: ulid(),
    action: REVOCATION_ACTIONS.credentialsRevoked,
    subjectId: asked.personId,
    detail: { grants },
  });
  await recordGrantsEndedHere(admin, tx, { personId: asked.personId, grants });
  return ok({ personId: asked.personId, revokedAt: at.toISOString() });
};

/**
 * Every session and token the member was issued before the instant is refused in this workspace
 * and nowhere else, and a fresh sign-in is admitted. The answer is the same whether or not the
 * person belongs to another workspace. Revoking the last Admin, themself included, is allowed.
 */
export const endEverySignInAndTokenHere = async (
  principal: UserPrincipal,
  tx: Tx,
  input: EndEverySignInAndTokenHereInput,
): Promise<Result<CredentialsRevokedHere, EndEverySignInAndTokenHereRefusal>> => {
  const admitted = admit(endEverySignInAndTokenHereAction, principal, input);
  if (!admitted.ok) return err(admitted.error);

  const revoked = await attempt(() => revokedHere(admitted.value, tx, input));
  return revoked.ok ? revoked.value : err(refusalOfDeadlock(revoked.error));
};
