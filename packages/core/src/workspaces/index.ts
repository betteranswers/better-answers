import { boundarySchemas, CREATOR_ROLE } from "@better-answers/schema";

import { act, declareActs, record } from "../audit/index.ts";
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
  withIdentityRead,
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

/**
 * The slice's acts on the ledger (ADR 0038). Provisioning is a platform act whose row
 * lands in the workspace it creates — the one act of the platform's that has a workspace
 * to land in. Revocation's acts are not here: *revoke everywhere* runs over the identity
 * set with no workspace and stays a log line until T-028's identity-set ledger; *revoke in
 * a workspace* is T-027's act and declares itself there.
 */
export const WORKSPACE_ACTS = declareActs("platform", {
  provisioned: act("platform.workspace.provisioned", { adminUserId: "id", role: "role" }),
});

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
 * One transaction: the workspace row, its ledger row, its chunk partition (through the one
 * SECURITY DEFINER lifecycle function, ADR 0032), the Admin membership and the
 * config row. Any failure rolls the whole act back — a workspace never exists without
 * its partition, and the test "leaves nothing behind when the admin does not exist"
 * holds that. The ledger row is written second on purpose: the failures the tests
 * provoke come after it, so they prove the row rolls back with the act rather than that
 * it was never reached.
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
      // `withScope` already runs as the new workspace, so the row lands in the workspace
      // it creates; the detail names the first Admin by person id and role word.
      await record(platform, tx, {
        id: ulid(),
        act: WORKSPACE_ACTS.provisioned,
        subjectId: row.data.id,
        detail: { adminUserId: admin.data, role: CREATOR_ROLE },
      });
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
 *
 * Not on the ledger: it runs unscoped over the identity set and has no workspace for a
 * row to land in, so it is a log line at its caller until T-028's identity-set ledger
 * exists (ADR 0038). The workspace-scoped act (T-027) is the one that writes a row.
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
 * Which workspaces does this person hold? The picker's read (ADR 0035), and the one the
 * identity provider's three pre-workspace paths share: the session-create hook that
 * makes a sole membership active before the session exists, the consent reference that
 * puts a `workspace` claim on a credential, and the redirect decision that sends a
 * person to the picker or past it (`apps/api/src/auth/auth.ts`). `member` is a table the
 * workspaces slice does not own, so the read is a slice function and the fact is an entry
 * on the table-ownership map, where a second copy of it would be a visible diff
 * (ADR 0029; `packages/schema`'s map).
 *
 * **Unscoped, through the identity-read door.** It runs before a workspace is known, so
 * there is no scope to set and a scoped read would see nothing; `member` carries no
 * policy for exactly this reason, which is the sentence its RLS exemption makes
 * (ADR 0009). `withIdentityRead` rather than the raw pool, because every statement in a
 * slice reaches Postgres through a door holding the principal it is made under
 * (ADR 0029's amendment) — and the platform principal is that principal here for the
 * reason `revokeCredentials`'s is: the identity set is not a tenant's, so the read is the
 * platform's own. A read writes no ledger row.
 *
 * **It reads by person id and by nothing else**, and answers ids and nothing else: no
 * name, no role, no row count, no other person's membership. A caller that could ask
 * "who is in workspace X" would be a cross-tenant oracle on a table with no policy, and
 * the argument list is where that is refused — there is no argument to ask it with. An id
 * that is not a person id is `malformed` rather than an empty list, so a caller cannot
 * read "holds nothing" from an argument the boundary never accepted.
 */
export const workspacesHeldBy = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  userId: string,
): Promise<Result<readonly WorkspaceId[], "malformed" | Error>> => {
  const person = boundarySchemas.user.select.shape.id.safeParse(userId);
  if (!person.success) return err("malformed");

  const held = await attempt(() =>
    withIdentityRead(platform, door, async (tx) => {
      const memberships = await tx.query<{ workspace_id: string }>(
        "SELECT workspace_id FROM member WHERE user_id = $1 ORDER BY workspace_id",
        [person.data],
      );
      // The column is a foreign key to `workspace.id`, so it is parsed at the boundary
      // rather than asserted (ADR 0028): a value that is not a workspace id comes back as
      // the store's Error and never as an id the picker would act on.
      return memberships.rows.map((row) =>
        boundarySchemas.workspace.select.shape.id.parse(row.workspace_id),
      );
    }),
  );
  if (!held.ok) return err(held.error);
  return ok(held.value);
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
