import { boundarySchemas, CREATOR_ROLE } from "@better-answers/schema";

import { attempt, err, ok, type Result } from "../kernel/index.ts";
import type { PlatformPrincipal, Role, UserId, UserPrincipal, WorkspaceId } from "../kernel/index.ts";
import { type PostgresDoor, type Tx, withIdentityWrite, withScope } from "../store/postgres/index.ts";

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
  Result<{ workspaceId: WorkspaceId; actorId: PlatformPrincipal["actorId"] }, ProvisionRefusal>
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
      await tx.query(
        "INSERT INTO member (id, workspace_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, now())",
        [`member-${row.data.id}-${admin.data}`, row.data.id, admin.data, CREATOR_ROLE],
      );
      await tx.query(
        "INSERT INTO workspace_config (workspace_id, key, value) VALUES ($1, $2, $3)",
        [row.data.id, TOOLS_LIST_TTL_CONFIG_KEY, String(TOOLS_LIST_TTL_MS_DEFAULT)],
      );
    }),
  );
  if (!act.ok) return err(classify(act.error));
  return ok({ workspaceId: row.data.id, actorId: platform.actorId });
};

/** Postgres's constraint names, read into the slice's own vocabulary. */
const classify = (error: Error): ProvisionRefusal => {
  // node-postgres puts the violated constraint's name on the error it throws.
  const constraint =
    "constraint" in error && typeof error.constraint === "string" ? error.constraint : "";
  const detail = `${error.message} ${constraint}`;
  if (detail.includes("workspace_slug_unique")) return "slug-taken";
  if (detail.includes("workspace_pkey")) return "workspace-exists";
  if (detail.includes("member_user_id_user_id_fk")) return "no-such-user";
  throw error;
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
 */
export const readMembership = async (
  principal: UserPrincipal,
  tx: Tx,
): Promise<Result<Membership, "no-such-workspace" | "no-such-person">> => {
  const workspace = await tx.query<{ name: string }>(
    "SELECT name FROM workspace WHERE id = $1",
    [principal.workspaceId],
  );
  const name = workspace.rows[0]?.name;
  if (name === undefined) return err("no-such-workspace");

  const person = await tx.query<{ name: string | null; email: string }>(
    'SELECT name, email FROM "user" WHERE id = $1',
    [principal.userId],
  );
  const row = person.rows[0];
  if (row === undefined) return err("no-such-person");

  return ok({
    workspace: { id: principal.workspaceId, name },
    person: { id: principal.userId, name: row.name, email: row.email },
    role: principal.role,
  });
};
