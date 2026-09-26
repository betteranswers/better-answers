import { act, declareIdentitySetActs, record, type EndedGrant } from "../audit/index.ts";
import { ulid, type UserId, type UserPrincipal, type WorkspaceId } from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";

/** The operator reads a person's ended grants from here, since no workspace's audit log is theirs. */
const ENDING_ACTS = declareIdentitySetActs("people", {
  revoked: act("people.person.credentials_revoked", { grants: "grants" }),
  endedHere: act("people.person.grants_ended", { workspaceId: "id", grants: "grants" }),
});

export const REVOKED_EVERYWHERE = ENDING_ACTS.revoked;

export const GRANTS_ENDED_HERE = ENDING_ACTS.endedHere;

/** Every workspace's tokens where `workspaceId` is null; only those consented in it otherwise. */
type TokensToEnd = {
  readonly personId: UserId;
  readonly before: Date;
  readonly workspaceId: WorkspaceId | null;
};

export type TokensEnded = {
  readonly grants: readonly EndedGrant[];
  readonly refreshTokensEnded: number;
  readonly accessTokensEnded: number;
};

const TOKENS_TO_END =
  "user_id = $1 AND created_at < $2 AND ($3::text IS NULL OR reference_id = $3)";

/**
 * A grant is one authorisation's family, issued at its earliest row, and open only while an
 * unrotated row stands unrevoked: the provider ended the rest.
 */
const REFRESH_TOKENS_ENDED = `WITH ended AS (
         DELETE FROM oauth_refresh_token WHERE ${TOKENS_TO_END}
         RETURNING id, client_id, reference_id, authorization_code_id, created_at, rotated_at,
                   revoked)
       SELECT client_id, reference_id AS workspace_id, min(created_at) AS issued_at,
              count(*)::int AS tokens, bool_or(rotated_at IS NULL AND revoked IS NULL) AS open
         FROM ended
        GROUP BY COALESCE(authorization_code_id, id), client_id, reference_id
        ORDER BY issued_at, client_id, workspace_id`;

/** The detail kind refuses a grant as `record` writes it: the one check, where it enters. */
type DeletedGrantRow = {
  readonly client_id: string;
  readonly workspace_id: WorkspaceId | null;
  readonly issued_at: Date;
  readonly tokens: number;
  readonly open: boolean;
};

const endedGrantOf = (row: DeletedGrantRow): EndedGrant => ({
  clientId: row.client_id,
  workspaceId: row.workspace_id,
  issuedAt: row.issued_at.toISOString(),
});

/**
 * Deletes the person's OAuth tokens issued before the instant, answering the grants they held.
 * Deleted rather than marked: a marked refresh token presented later makes the provider delete
 * every grant the person holds for that client, a later one included.
 */
export const endTokens = async (tx: Tx, asked: TokensToEnd): Promise<TokensEnded> => {
  const parameters = [asked.personId, asked.before, asked.workspaceId];
  // Access tokens first: deleting a refresh token cascades to its own, which would go uncounted.
  const access = await tx.query(
    `DELETE FROM oauth_access_token WHERE ${TOKENS_TO_END}`,
    parameters,
  );
  const refresh = await tx.query<DeletedGrantRow>(REFRESH_TOKENS_ENDED, parameters);
  return {
    grants: refresh.rows.filter((row) => row.open).map(endedGrantOf),
    refreshTokensEnded: refresh.rows.reduce((sum, row) => sum + row.tokens, 0),
    accessTokensEnded: access.rowCount ?? 0,
  };
};

/**
 * The step after a workspace act's own row, in its transaction: the person's ended grants on the
 * identity-set audit log, under the Admin. An act that ended none writes nothing here.
 */
export const recordGrantsEndedHere = async (
  admin: UserPrincipal,
  tx: Tx,
  ended: { readonly personId: UserId; readonly grants: readonly EndedGrant[] },
): Promise<void> => {
  if (ended.grants.length === 0) return;
  await record(admin, tx, {
    id: ulid(),
    act: GRANTS_ENDED_HERE,
    subjectId: ended.personId,
    detail: { workspaceId: admin.workspaceId, grants: ended.grants },
  });
};
