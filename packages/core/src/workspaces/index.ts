import { boundarySchemas, CREATOR_ROLE } from "@better-answers/schema";

import { attempt, err, ok, refusalFor, type Result, ulid } from "../kernel/index.ts";
import type {
  PlatformPrincipal,
  Role,
  UserId,
  UserPrincipal,
  WorkspaceId,
} from "../kernel/index.ts";
import {
  type PostgresDoor,
  type Tx,
  withIdentityWrite,
  withScope,
} from "../store/postgres/index.ts";

/**
 * Slice: **workspaces** — the tenant's own lifecycle. Owns `workspace` as the platform
 * sees it (Better Auth owns it as its organisation model), the first membership, and
 * `workspace_config`.
 *
 * Provisioning is **platform-provisioned** (grilling Q11, 2026-09-01): a person cannot
 * create a workspace — Better Auth's own creation endpoint is closed
 * (`allowUserToCreateOrganization: false`) — and the one act that creates one is
 * `provisionWorkspace`, called by T-005's bootstrap and by any later path under a
 * platform principal. Self-serve is one flag later, and that flag's path is wired to
 * the same partition step (`apps/api/src/auth/auth.ts`).
 */

/** The `tools/list` cache lifetime a new workspace starts with; an Admin raises it in System. */
export const TOOLS_LIST_TTL_MS_DEFAULT = 300_000;
export const TOOLS_LIST_TTL_CONFIG_KEY = "mcp.tools_list_ttl_ms";

export type ProvisionWorkspaceInput = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  /** The person who becomes the workspace's first Admin. */
  readonly adminUserId: string;
};

export type ProvisionRefusal = "slug-taken" | "workspace-exists" | "no-such-user" | "malformed";

/** The three violations provisioning has a word for; every other failure is the store's. */
const PROVISION_CONSTRAINTS = {
  workspace_slug_unique: "slug-taken",
  workspace_pkey: "workspace-exists",
  member_user_id_user_id_fk: "no-such-user",
} as const satisfies Record<string, ProvisionRefusal>;

/**
 * One transaction: the workspace row, its chunk partition (through the one
 * SECURITY DEFINER lifecycle function, ADR 0032), the Admin membership and the
 * config row. Any failure rolls the whole act back — a workspace never exists without
 * its partition, and the test "leaves nothing behind when the admin does not exist"
 * holds that.
 */
export const provisionWorkspace = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: ProvisionWorkspaceInput,
): Promise<
  Result<
    { workspaceId: WorkspaceId; actorId: PlatformPrincipal["actorId"] },
    ProvisionRefusal | Error
  >
> => {
  const row = boundarySchemas.workspace.insert.safeParse({
    id: input.id,
    name: input.name,
    slug: input.slug,
  });
  const admin = boundarySchemas.user.select.shape.id.safeParse(input.adminUserId);
  if (!row.success || !admin.success) return err("malformed");

  const act = await attempt(() =>
    withScope(platform, door, row.data.id, async (tx) => {
      await tx.query("INSERT INTO workspace (id, name, slug) VALUES ($1, $2, $3)", [
        row.data.id,
        row.data.name,
        row.data.slug,
      ]);
      await tx.query("SELECT create_workspace_partition($1)", [row.data.id]);
      // The membership's key is minted, never composed from the workspace and person
      // ids it sits between: nothing of ours references it, and a composed key would
      // read as a fact about the two — People acts key by (workspace, person).
      await tx.query(
        "INSERT INTO member (id, workspace_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, now())",
        [ulid(), row.data.id, admin.data, CREATOR_ROLE],
      );
      await tx.query(
        "INSERT INTO workspace_config (workspace_id, key, value) VALUES ($1, $2, $3)",
        [row.data.id, TOOLS_LIST_TTL_CONFIG_KEY, String(TOOLS_LIST_TTL_MS_DEFAULT)],
      );
    }),
  );
  // A named constraint becomes the word a caller can act on; anything else comes back
  // as the store's own Error, so the seam answers a value either way.
  if (!act.ok) return err(refusalFor(act.error, PROVISION_CONSTRAINTS));
  return ok({ workspaceId: row.data.id, actorId: platform.actorId });
};

export type RevokeCredentialsInput = {
  readonly userId: string;
  /** The instant; every credential issued before it is refused from now on. */
  readonly at: Date;
};

/**
 * Revoke a person's credentials (ADR 0018): one act, one transaction. Writes the instant
 * the resolver compares every credential's issue time against, ends every browser
 * session created before it, and revokes every refresh token minted before it — so a
 * stolen refresh token cannot mint an access token whose `iat` post-dates the
 * revocation, and a live browser session cannot consent to a new grant. The People
 * screen calls this; until then, the tests do.
 */
export const revokeCredentials = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: RevokeCredentialsInput,
): Promise<
  Result<{ userId: string; actorId: PlatformPrincipal["actorId"] }, "no-such-user" | Error>
> => {
  const userId = boundarySchemas.user.select.shape.id.safeParse(input.userId);
  if (!userId.success) return err("no-such-user");
  const revoked = await attempt(() =>
    withIdentityWrite(platform, door, async (tx) => {
      // The instant never moves backwards: two revocations out of order keep the later
      // one, and the sessions and tokens are ended against that effective instant.
      const person = await tx.query<{ at: Date }>(
        'UPDATE "user" SET credentials_revoked_at = GREATEST(COALESCE(credentials_revoked_at, $2), $2) WHERE id = $1 RETURNING credentials_revoked_at AS at',
        [userId.data, input.at],
      );
      const at = person.rows[0]?.at;
      if (at === undefined) return undefined;
      await tx.query("DELETE FROM session WHERE user_id = $1 AND created_at < $2", [
        userId.data,
        at,
      ]);
      await tx.query(
        "UPDATE oauth_refresh_token SET revoked = now() WHERE user_id = $1 AND created_at < $2 AND revoked IS NULL",
        [userId.data, at],
      );
      await tx.query(
        "UPDATE oauth_access_token SET revoked = now() WHERE user_id = $1 AND created_at < $2 AND revoked IS NULL",
        [userId.data, at],
      );
      return at;
    }),
  );
  // No constraint of this act's is a refusal a caller can act on, so a failure is the
  // store's and comes back as the normalised Error itself — the cause kept, the
  // convention (a Result, never a rejection) held.
  if (!revoked.ok) return err(revoked.error);
  if (revoked.value === undefined) return err("no-such-user");
  return ok({ userId: userId.data, actorId: platform.actorId });
};

export type RevokeWorkspaceTokensInput = {
  readonly workspaceId: string;
  readonly userId: string;
  /** The instant; every token minted for this workspace before it is ended. */
  readonly at: Date;
};

/**
 * Revocation's workspace scope, the token half (ADR 0035): end the refresh and access
 * tokens this person holds **for this workspace** and minted before the instant. The
 * act around it — writing the instant on the membership row and its ledger row — is
 * T-027's; this is the predicate that act calls, landed and tested first.
 *
 * A token's consented workspace is the reference id the grant carried, which Better
 * Auth writes onto the token row at mint and reads back as the `workspace` claim
 * (`apps/api/src/auth/auth.ts`, `customAccessTokenClaims`). The predicate matches that
 * column and never joins, so it cannot reach a row of another workspace's however the
 * arguments are chosen; a grant that named no workspace matches nothing and stays.
 *
 * Sessions are not ended here, and that is the point of the two scopes: a browser
 * session belongs to the person, not to one workspace, so ending it would reach the
 * other company's tenant. What refuses a session in this workspace is the membership
 * instant the resolver reads (`withPrincipal`); *revoke everywhere* is the act that
 * ends sessions.
 *
 * The first argument is the platform principal because this is a write to the identity
 * set, which no workspace scope reaches — not because the caller is the platform. The
 * Admin's authority is checked by T-027's act, which narrows its own user principal to
 * Admin and then makes this write as the platform; the workspace it may write is the
 * one it passes here, and it is the act's business that the two agree.
 *
 * A revoked token stops a *refresh*: the bearer path verifies an access token's JWT
 * statelessly, so what refuses an already-minted access token in this workspace is the
 * membership instant, not this row. Ending the rows and writing the instant belong to
 * the one act (T-027).
 */
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
    // The token tables are the identity set's, which no workspace scope reaches; the
    // workspace is the predicate's own argument, not the transaction's.
    withIdentityWrite(platform, door, async (tx) => {
      const end = async (table: "oauth_refresh_token" | "oauth_access_token"): Promise<number> => {
        const updated = await tx.query(
          `UPDATE ${table} SET revoked = now()
            WHERE user_id = $1 AND reference_id = $2 AND created_at < $3 AND revoked IS NULL`,
          [userId.data, workspaceId.data, input.at],
        );
        return updated.rowCount ?? 0;
      };
      // The refresh row first: an access token outliving its parent is the window a
      // rotation would mint through.
      const refreshTokensEnded = await end("oauth_refresh_token");
      const accessTokensEnded = await end("oauth_access_token");
      return { refreshTokensEnded, accessTokensEnded };
    }),
  );
  // No constraint of this act's is a refusal a caller can act on; a store failure comes
  // back as the normalised Error, the convention (a Result, never a rejection) held.
  if (!ended.ok) return err(ended.error);
  return ok({
    workspaceId: workspaceId.data,
    userId: userId.data,
    actorId: platform.actorId,
    ...ended.value,
  });
};

/**
 * Who the person is, where they are and at what role — the three the shell names
 * (T-037, user stories 9 and 10). The role is the Principal's, resolved in this same
 * transaction against the member row; the two names are looked up beside it.
 */
export type Membership = {
  readonly workspace: { readonly id: WorkspaceId; readonly name: string };
  /** `name` is null until a person has told us one; the shell falls back to the address. */
  readonly person: { readonly id: UserId; readonly name: string | null; readonly email: string };
  readonly role: Role;
};

/**
 * Read the current membership as the Principal. `workspace` and `user` are identity-set
 * tables and carry no policy (ADR 0009, 2026-09-01), so both statements name their row's
 * id — the Principal's own, never one from a caller — and neither lists across
 * principals. The role is not read again: it is the one the resolver already refused a
 * disagreeing member row over (`withPrincipal`), and reading it twice would be two
 * answers where the platform has one.
 *
 * Two refusals a caller can act on — a session pointing at rows that are gone — and the
 * store's Error for anything else, so the seam answers a value however the read ends
 * (the kernel's result convention, `kernel/result.ts`).
 */
export const readMembership = async (
  principal: UserPrincipal,
  tx: Tx,
): Promise<Result<Membership, "no-such-workspace" | "no-such-person" | Error>> => {
  const workspace = await attempt(() =>
    tx.query<{ name: string }>("SELECT name FROM workspace WHERE id = $1", [principal.workspaceId]),
  );
  if (!workspace.ok) return err(workspace.error);
  const name = workspace.value.rows[0]?.name;
  if (name === undefined) return err("no-such-workspace");

  const person = await attempt(() =>
    tx.query<{ name: string | null; email: string }>(
      'SELECT name, email FROM "user" WHERE id = $1',
      [principal.userId],
    ),
  );
  if (!person.ok) return err(person.error);
  const row = person.value.rows[0];
  if (row === undefined) return err("no-such-person");

  return ok({
    workspace: { id: principal.workspaceId, name },
    person: { id: principal.userId, name: row.name, email: row.email },
    role: principal.role,
  });
};
