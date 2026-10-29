import { z } from "zod";

import { boundarySchemas } from "@better-answers/schema";

import { type EndedGrant, record } from "../audit/index.ts";
import {
  attempt,
  err,
  ok,
  requireFreshConfirmation,
  type Result,
  ulid,
  type AdminUserPrincipal,
  type OperatorPrincipal,
  type PlatformPrincipal,
  type UserId,
  type WorkspaceId,
} from "../kernel/index.ts";
import { type PostgresDoor, type Tx, withIdentityWrite } from "../store/postgres/index.ts";
import { endTokens, REVOKED_EVERYWHERE, type TokensEnded } from "./grants.ts";
import type { WorkspaceRefusal } from "./vocabulary.ts";

export const endEverySignInAndTokenInput = z.object({
  personId: boundarySchemas.user.select.shape.id,
});

type EndEverySignInAndTokenInput = z.output<typeof endEverySignInAndTokenInput> & {
  readonly at: Date;
};

type CredentialsRevoked = {
  readonly personId: UserId;

  readonly revokedAt: string;
};

export type EndEverySignInAndTokenRefusal = WorkspaceRefusal<
  "no-such-user" | "confirmation-too-old"
>;

type CredentialsEnded = { readonly held: Date; readonly grants: readonly EndedGrant[] };

const endingCredentials = async (
  tx: Tx,
  personId: UserId,
  at: Date,
): Promise<CredentialsEnded | undefined> => {
  const person = await tx.query<{ at: Date }>(
    'UPDATE "user" SET credentials_revoked_at = GREATEST(COALESCE(credentials_revoked_at, $2), $2), updated_at = now() WHERE id = $1 RETURNING credentials_revoked_at AS at',
    [personId, at],
  );
  const held = person.rows[0]?.at;
  if (held === undefined) return undefined;
  await tx.query("DELETE FROM session WHERE user_id = $1 AND created_at < $2", [personId, held]);
  const { grants } = await endTokens(tx, { personId, before: held, workspaceId: null });
  return { held, grants };
};

/**
 * Ends every session and OAuth token the person was issued before the revocation instant, in every
 * workspace. The instant only moves forward.
 */
export const endEverySignInAndToken = async (
  operator: OperatorPrincipal,
  tx: Tx,
  input: EndEverySignInAndTokenInput,
): Promise<Result<CredentialsRevoked, EndEverySignInAndTokenRefusal | Error>> => {
  const fresh = requireFreshConfirmation(operator, input.at);
  if (!fresh.ok) return err(fresh.error);
  const { personId } = input;

  const ended = await attempt(() => endingCredentials(tx, personId, input.at));
  if (!ended.ok) return err(ended.error);
  if (ended.value === undefined) return err("no-such-user");

  await record(fresh.value, tx, {
    id: ulid(),
    action: REVOKED_EVERYWHERE,
    subjectId: personId,
    detail: { grants: ended.value.grants },
  });
  return ok({ personId, revokedAt: ended.value.held.toISOString() });
};

export type RevokeWorkspaceTokensInput = {
  readonly workspaceId: string;
  readonly userId: string;

  readonly at: Date;
};

export const endWorkspaceTokens = (
  _admitted: PlatformPrincipal | AdminUserPrincipal,
  tx: Tx,
  input: { readonly workspaceId: WorkspaceId; readonly personId: UserId; readonly at: Date },
): Promise<TokensEnded> =>
  endTokens(tx, { personId: input.personId, before: input.at, workspaceId: input.workspaceId });

export const revokeWorkspaceTokens = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: RevokeWorkspaceTokensInput,
): Promise<
  Result<
    {
      workspaceId: WorkspaceId;
      userId: string;
      actorId: PlatformPrincipal["actorId"];
      refreshTokensEnded: number;
      accessTokensEnded: number;
    },
    "malformed" | Error
  >
> => {
  const workspaceId = boundarySchemas.workspace.select.shape.id.safeParse(input.workspaceId);
  const userId = boundarySchemas.user.select.shape.id.safeParse(input.userId);
  if (!workspaceId.success || !userId.success) return err("malformed");

  const ended = await attempt(() =>
    withIdentityWrite(platform, door, (tx) =>
      endWorkspaceTokens(platform, tx, {
        workspaceId: workspaceId.data,
        personId: userId.data,
        at: input.at,
      }),
    ),
  );

  if (!ended.ok) return err(ended.error);
  return ok({
    workspaceId: workspaceId.data,
    userId: userId.data,
    actorId: platform.actorId,
    refreshTokensEnded: ended.value.refreshTokensEnded,
    accessTokensEnded: ended.value.accessTokensEnded,
  });
};
