import { z } from "zod";

import { boundarySchemas } from "@better-answers/schema";

import { act, declareActs, record } from "../audit/index.ts";
import {
  admit,
  attempt,
  declareAct,
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
import { endWorkspaceTokens } from "../workspaces/index.ts";
import type { MemberRefusal } from "./vocabulary.ts";

const REVOCATION_ACTS = declareActs("people", {
  credentialsRevoked: act("people.member.credentials_revoked", {}),
});

export const revokeCredentialsHereInput = z.object({
  personId: boundarySchemas.user.select.shape.id,
});

export type RevokeCredentialsHereInput = z.output<typeof revokeCredentialsHereInput> & {
  /** When the act happens: every credential the member was issued before it is refused here. */
  readonly at: Date;
};

const revokeCredentialsHereAct = declareAct({
  admits: { role: "Admin", purposes: [] },
  input: revokeCredentialsHereInput,
  refuses: ["role-forbids", "no-such-member", "changed-meanwhile"],
  effect: "write",
});

export type RevokeCredentialsHereRefusal =
  | MemberRefusal<RefusalOf<typeof revokeCredentialsHereAct>>
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
  admin: AdmittedOf<typeof revokeCredentialsHereAct>,
  tx: Tx,
  asked: RevokeCredentialsHereInput,
): Promise<Result<CredentialsRevokedHere, MemberRefusal<"no-such-member">>> => {
  const held = await tx.query<{ at: Date }>(HELD_INSTANT, [
    admin.workspaceId,
    asked.personId,
    asked.at,
  ]);
  const at = held.rows[0]?.at;
  if (at === undefined) return err("no-such-member");

  await endWorkspaceTokens(admin, tx, {
    workspaceId: admin.workspaceId,
    personId: asked.personId,
    at,
  });
  await record(admin, tx, {
    id: ulid(),
    act: REVOCATION_ACTS.credentialsRevoked,
    subjectId: asked.personId,
    detail: {},
  });
  return ok({ personId: asked.personId, revokedAt: at.toISOString() });
};

/**
 * Every session and token the member was issued before the instant is refused in this workspace
 * and nowhere else, and a fresh sign-in is admitted. The answer is the same whether or not the
 * person belongs to another workspace. Revoking the last Admin, themself included, is allowed.
 */
export const revokeCredentialsHere = async (
  principal: UserPrincipal,
  tx: Tx,
  input: RevokeCredentialsHereInput,
): Promise<Result<CredentialsRevokedHere, RevokeCredentialsHereRefusal>> => {
  const admitted = admit(revokeCredentialsHereAct, principal, input);
  if (!admitted.ok) return err(admitted.error);

  const revoked = await attempt(() => revokedHere(admitted.value, tx, input));
  return revoked.ok ? revoked.value : err(refusalOfDeadlock(revoked.error));
};
