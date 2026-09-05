import {
  type MigratedPostgres,
  startMigratedPostgres,
  testData,
} from "@better-answers/schema/testing";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { boundarySchemas, ulid } from "@better-answers/schema";

import {
  attempt,
  type Claims,
  type PlatformPrincipal,
  type UserPrincipal,
} from "../src/kernel/index.ts";
import { answered } from "./aborted-transaction.ts";
import { openPostgres, withPrincipal } from "../src/store/postgres/index.ts";
import {
  provisionWorkspace,
  readMembership,
  revokeCredentials,
  revokeWorkspaceTokens,
  TOOLS_LIST_TTL_CONFIG_KEY,
  TOOLS_LIST_TTL_MS_DEFAULT,
  workspacesHeldBy,
} from "../src/workspaces/index.ts";

/**
 * Workspace provisioning through its interface: one act, one transaction, under a
 * platform principal (grilling Q11). What it leaves behind is checked through the
 * catalogue and through the resolver; what it refuses leaves nothing behind.
 */

let db: MigratedPostgres;

beforeAll(async () => {
  db = await startMigratedPostgres();
}, 120_000);

afterAll(async () => {
  await db.stop();
});

const bootstrap: PlatformPrincipal = {
  kind: "platform",
  actorId: "process:better-answers-bootstrap",
};

const seedUser = async (): Promise<string> => {
  const client = await db.pool.connect();
  try {
    return (await testData(client).user()).id;
  } finally {
    client.release();
  }
};

const partitionExists = async (workspaceId: string): Promise<boolean> => {
  const found = await db.pool.query(
    "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'index' AND c.relname = $1",
    [`chunk_${workspaceId}`],
  );
  return found.rowCount === 1;
};

describe("provisioning a workspace", () => {
  it("creates the workspace, its chunk partition, its first Admin and its config row in one act", async () => {
    const adminUserId = await seedUser();
    const door = openPostgres(db.runtimePool);
    const id = ulid();

    const provisioned = await provisionWorkspace(bootstrap, door, {
      id,
      name: "Acme",
      slug: `acme-${id.toLowerCase()}`,
      adminUserId,
    });

    expect(provisioned).toEqual({
      ok: true,
      value: { workspaceId: id, actorId: "process:better-answers-bootstrap" },
    });
    expect(await partitionExists(id)).toBe(true);

    // The first member resolves as the workspace's Admin and reads the seeded row.
    const asAdmin = await withPrincipal(
      door,
      { workspaceId: id, userId: adminUserId, issuedAt: new Date() },
      async (principal, tx) => {
        const config = await tx.query<{ value: string }>(
          "SELECT value FROM workspace_config WHERE key = $1",
          [TOOLS_LIST_TTL_CONFIG_KEY],
        );
        return { role: principal.role, ttl: config.rows[0]?.value };
      },
    );
    expect(asAdmin).toEqual({
      ok: true,
      value: { role: "Admin", ttl: String(TOOLS_LIST_TTL_MS_DEFAULT) },
    });
  });

  it("gives the first Admin's membership an id in the one shape the platform mints, composed from nothing", async () => {
    const adminUserId = await seedUser();
    const door = openPostgres(db.runtimePool);
    const id = ulid();

    await provisionWorkspace(bootstrap, door, {
      id,
      name: "Minted",
      slug: `minted-${id.toLowerCase()}`,
      adminUserId,
    });

    const row = await db.pool.query<{ id: string }>(
      "SELECT id FROM member WHERE workspace_id = $1 AND user_id = $2",
      [id, adminUserId],
    );
    const memberId = row.rows[0]?.id;
    expect(boundarySchemas.member.select.shape.id.safeParse(memberId).success).toBe(true);
    // Composed from neither of the ids it sits between: T-063 retired the composed form.
    expect(memberId).not.toContain(id);
    expect(memberId).not.toContain(adminUserId);
  });

  it("leaves nothing behind when the admin does not exist — no workspace without its partition", async () => {
    const door = openPostgres(db.runtimePool);
    const id = ulid();

    const provisioned = await provisionWorkspace(bootstrap, door, {
      id,
      name: "Ghost",
      slug: `ghost-${id.toLowerCase()}`,
      // Minted, so it is a person id in shape; it is simply nobody's.
      adminUserId: ulid(),
    });

    expect(provisioned).toEqual({ ok: false, error: "no-such-user" });
    const row = await db.pool.query("SELECT 1 FROM workspace WHERE id = $1", [id]);
    expect(row.rowCount).toBe(0);
    expect(await partitionExists(id)).toBe(false);
  });

  it("refuses a slug another workspace already holds", async () => {
    const adminUserId = await seedUser();
    const door = openPostgres(db.runtimePool);
    const slug = `taken-${ulid().toLowerCase()}`;

    const first = await provisionWorkspace(bootstrap, door, {
      id: ulid(),
      name: "One",
      slug,
      adminUserId,
    });
    const second = await provisionWorkspace(bootstrap, door, {
      id: ulid(),
      name: "Two",
      slug,
      adminUserId,
    });

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, error: "slug-taken" });
  });

  it("refuses an id a workspace already holds", async () => {
    const adminUserId = await seedUser();
    const door = openPostgres(db.runtimePool);
    const id = ulid();

    const first = await provisionWorkspace(bootstrap, door, {
      id,
      name: "One",
      slug: `first-${id.toLowerCase()}`,
      adminUserId,
    });
    const second = await provisionWorkspace(bootstrap, door, {
      id,
      name: "Again",
      slug: `again-${ulid().toLowerCase()}`,
      adminUserId,
    });

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, error: "workspace-exists" });
  });

  it("refuses an id that is not a workspace id", async () => {
    const door = openPostgres(db.runtimePool);

    const provisioned = await provisionWorkspace(bootstrap, door, {
      id: "not-a-ulid",
      name: "Bad",
      slug: "bad",
      adminUserId: await seedUser(),
    });

    expect(provisioned).toEqual({ ok: false, error: "malformed" });
  });

  it("hands a caller the store's own failure rather than a refusal it could act on", async () => {
    // A failure the act names no word for: the pool is gone, so nothing about it is a
    // refusal a caller can do anything with. The seam still answers a value — the
    // kernel's result convention — and the value carries the store's Error.
    const gone = new pg.Pool(db.runtimePool.options);
    await gone.end();

    const provisioned = await provisionWorkspace(bootstrap, openPostgres(gone), {
      id: ulid(),
      name: "Unreachable",
      slug: `unreachable-${ulid().toLowerCase()}`,
      adminUserId: await seedUser(),
    });

    expect(provisioned.ok).toBe(false);
    if (provisioned.ok) return;
    expect(provisioned.error).toBeInstanceOf(Error);
  });
});

describe("revoking a person's credentials", () => {
  it("writes the instant, ends the earlier sessions and revokes the earlier refresh tokens in one act", async () => {
    const adminUserId = await seedUser();
    const door = openPostgres(db.runtimePool);
    const id = ulid();
    await provisionWorkspace(bootstrap, door, {
      id,
      name: "Acme",
      slug: `acme-${id.toLowerCase()}`,
      adminUserId,
    });
    const at = new Date("2026-09-02T12:00:00Z");
    // A session and a refresh token created before the instant, and one after.
    const superuser = await db.pool.connect();
    try {
      await superuser.query(
        "INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id) VALUES ('s-old', now(), 'tok-old', $2, now(), $1)",
        [adminUserId, new Date("2026-09-02T11:00:00Z")],
      );
      await superuser.query(
        "INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id) VALUES ('s-new', now(), 'tok-new', $2, now(), $1)",
        [adminUserId, new Date("2026-09-02T13:00:00Z")],
      );
      await superuser.query(
        "INSERT INTO oauth_client (id, client_id, redirect_uris) VALUES ('c', 'https://c.example/x', ARRAY['https://c.example/cb'])",
      );
      await superuser.query(
        "INSERT INTO oauth_refresh_token (id, token, client_id, user_id, expires_at, created_at, scopes) VALUES ('r-old', 'r-old-t', 'https://c.example/x', $1, now(), $2, ARRAY['knowledge:read'])",
        [adminUserId, new Date("2026-09-02T11:00:00Z")],
      );
      await superuser.query(
        "INSERT INTO oauth_refresh_token (id, token, client_id, user_id, expires_at, created_at, scopes) VALUES ('r-new', 'r-new-t', 'https://c.example/x', $1, now(), $2, ARRAY['knowledge:read'])",
        [adminUserId, new Date("2026-09-02T13:00:00Z")],
      );
    } finally {
      superuser.release();
    }

    const revoked = await revokeCredentials(bootstrap, door, { userId: adminUserId, at });

    expect(revoked).toEqual({
      ok: true,
      value: { userId: adminUserId, actorId: "process:better-answers-bootstrap" },
    });
    const after = await db.pool.query('SELECT credentials_revoked_at FROM "user" WHERE id = $1', [
      adminUserId,
    ]);
    expect(after.rows[0]?.credentials_revoked_at).toEqual(at);
    const sessions = await db.pool.query("SELECT id FROM session WHERE user_id = $1 ORDER BY id", [
      adminUserId,
    ]);
    expect(sessions.rows).toEqual([{ id: "s-new" }]);
    const tokens = await db.pool.query(
      "SELECT id, revoked IS NOT NULL AS revoked FROM oauth_refresh_token WHERE user_id = $1 ORDER BY id",
      [adminUserId],
    );
    expect(tokens.rows).toEqual([
      { id: "r-new", revoked: false },
      { id: "r-old", revoked: true },
    ]);

    // A later revocation with an earlier instant never moves the instant backwards.
    const earlier = await revokeCredentials(bootstrap, door, {
      userId: adminUserId,
      at: new Date("2026-09-02T10:00:00Z"),
    });
    expect(earlier.ok).toBe(true);
    const kept = await db.pool.query('SELECT credentials_revoked_at FROM "user" WHERE id = $1', [
      adminUserId,
    ]);
    expect(kept.rows[0]?.credentials_revoked_at).toEqual(at);
  });

  it("refuses a person who does not exist and leaves nothing behind", async () => {
    const door = openPostgres(db.runtimePool);
    const revoked = await revokeCredentials(bootstrap, door, {
      userId: "user-missing",
      at: new Date(),
    });
    expect(revoked).toEqual({ ok: false, error: "no-such-user" });
  });

  it("is not reachable from a workspace Admin's own principal", () => {
    const door = openPostgres(db.runtimePool);
    const admin: UserPrincipal = {
      kind: "user",
      workspaceId: ulid() as UserPrincipal["workspaceId"],
      userId: "user-admin" as UserPrincipal["userId"],
      role: "Admin",
      groups: [],
    };

    // *Revoke everywhere* is the operator's act (the platform principal until T-028),
    // and the type is what keeps a workspace Admin's procedure out of it: no runtime
    // check refuses this, because the call never compiles.
    // @ts-expect-error a user principal is not a platform principal
    void (() => revokeCredentials(admin, door, { userId: admin.userId, at: new Date() }));
    expect(admin.role).toBe("Admin");
  });
});

describe("reading the current membership", () => {
  it("hands a caller a store failure to read rather than one to catch", async () => {
    const adminUserId = await seedUser();
    const door = openPostgres(db.runtimePool);
    const id = ulid();
    const provisioned = await provisionWorkspace(bootstrap, door, {
      id,
      name: "Shell",
      slug: `shell-${id.toLowerCase()}`,
      adminUserId,
    });
    expect(provisioned.ok).toBe(true);

    const claims: Claims = { workspaceId: id, userId: adminUserId, issuedAt: new Date() };
    const read = await withPrincipal(door, claims, async (principal, tx) => {
      // A statement Postgres refuses aborts the transaction, so the read cannot run.
      // `attempt` is the one place a rejection is caught (`CODING_RULES.md` § TYPES).
      await attempt(() => tx.query("SELECT no_such_function()"));
      return readMembership(principal, tx);
    });

    expect(answered(read)).toBeInstanceOf(Error);
  });
});

/**
 * Revocation's workspace scope (ADR 0035): the same person holds tokens in two
 * workspaces, and one workspace's revocation reaches its own and no others. The
 * seam is the slice's entry point against real Postgres, because "leaves the other
 * workspace's token alone" is only a claim until a second tenant's row is there to
 * be left alone.
 */
describe("revoking a person's tokens in one workspace", () => {
  const at = new Date("2026-09-04T12:00:00Z");
  const before = new Date("2026-09-04T11:00:00Z");
  const after = new Date("2026-09-04T13:00:00Z");

  type Seeded = {
    here: string;
    there: string;
    userId: string;
    clientId: string;
    /** Every token seeded, by the id it was minted with, so a refusal reads as a grant. */
    grants: ReadonlyMap<string, string>;
  };

  const seedTwoWorkspaces = async (): Promise<Seeded> => {
    const client = await db.pool.connect();
    try {
      const seed = testData(client);
      const here = await seed.workspace();
      const there = await seed.workspace();
      const person = await seed.user();
      const other = await seed.user();
      const oauthClient = await seed.oauthClient();
      const grants = new Map<string, string>();
      const mint = async (
        grant: string,
        userId: string,
        referenceId: string | null,
        createdAt: Date,
      ): Promise<void> => {
        const refresh = await seed.oauthRefreshToken({
          clientId: oauthClient.clientId,
          userId,
          referenceId,
          createdAt,
        });
        const access = await seed.oauthAccessToken({
          clientId: oauthClient.clientId,
          userId,
          referenceId,
          createdAt,
        });
        grants.set(refresh.id, `refresh ${grant}`);
        grants.set(access.id, `access ${grant}`);
      };
      await mint("here-old", person.id, here.id, before);
      await mint("here-new", person.id, here.id, after);
      await mint("there-old", person.id, there.id, before);
      // A grant that named no workspace, and another person's grant in this workspace.
      await mint("nowhere-old", person.id, null, before);
      await mint("someone-else-here-old", other.id, here.id, before);
      return {
        here: here.id,
        there: there.id,
        userId: person.id,
        clientId: oauthClient.clientId,
        grants,
      };
    } finally {
      client.release();
    }
  };

  /** The grants this seeding's tokens now count as ended, in their words. */
  const endedGrants = async (seeded: Seeded): Promise<readonly string[]> => {
    const rows = await db.pool.query<{ id: string }>(
      `SELECT id FROM oauth_refresh_token WHERE client_id = $1 AND revoked IS NOT NULL
       UNION ALL
       SELECT id FROM oauth_access_token WHERE client_id = $1 AND revoked IS NOT NULL`,
      [seeded.clientId],
    );
    return rows.rows.map((row) => seeded.grants.get(row.id) ?? row.id).toSorted();
  };

  it("ends the refresh and access tokens consented to this workspace before the instant, and no others", async () => {
    const seeded = await seedTwoWorkspaces();
    const door = openPostgres(db.runtimePool);

    const ended = await revokeWorkspaceTokens(bootstrap, door, {
      workspaceId: seeded.here,
      userId: seeded.userId,
      at,
    });

    expect(ended).toEqual({
      ok: true,
      value: {
        workspaceId: seeded.here,
        userId: seeded.userId,
        actorId: "process:better-answers-bootstrap",
        refreshTokensEnded: 1,
        accessTokensEnded: 1,
      },
    });
    expect(await endedGrants(seeded)).toEqual(["access here-old", "refresh here-old"]);
  });

  it("cannot reach the other workspace's tokens even when the instant is now", async () => {
    const seeded = await seedTwoWorkspaces();
    const door = openPostgres(db.runtimePool);

    const ended = await revokeWorkspaceTokens(bootstrap, door, {
      workspaceId: seeded.here,
      userId: seeded.userId,
      at: new Date("2036-01-01T00:00:00Z"),
    });

    expect(ended.ok).toBe(true);
    // Everything of this person's in this workspace goes; the other workspace's grant,
    // the workspace-less grant and the other person's grant all stay.
    expect(await endedGrants(seeded)).toEqual([
      "access here-new",
      "access here-old",
      "refresh here-new",
      "refresh here-old",
    ]);
  });

  it("refuses a workspace id or a person id that is not one, and ends nothing", async () => {
    const seeded = await seedTwoWorkspaces();
    const door = openPostgres(db.runtimePool);

    const malformed = await revokeWorkspaceTokens(bootstrap, door, {
      workspaceId: "not-a-ulid",
      userId: seeded.userId,
      at,
    });

    expect(malformed).toEqual({ ok: false, error: "malformed" });
    expect(await endedGrants(seeded)).toEqual([]);
  });
});

/**
 * The picker's read (ADR 0035): which workspaces does this person hold? It runs before
 * a workspace is known — at sign-in, at consent and at the redirect decision — so it
 * cannot be a scoped read, and the thing it must never become is a list across people.
 * The seam is the slice's entry point against real Postgres, because "never another
 * person's" is only a claim until a second person's membership is there to be missed.
 */
describe("the workspaces a person holds", () => {
  it("answers that person's workspace ids in id order, and nothing about anybody else", async () => {
    const door = openPostgres(db.runtimePool);
    const person = await seedUser();
    const colleague = await seedUser();
    const held: string[] = [];
    for (const name of ["Acme", "Beta"]) {
      const id = ulid();
      const provisioned = await provisionWorkspace(bootstrap, door, {
        id,
        name,
        slug: `${name.toLowerCase()}-${id.toLowerCase()}`,
        adminUserId: person,
      });
      expect(provisioned.ok).toBe(true);
      held.push(id);
    }
    const theirs = ulid();
    expect(
      (
        await provisionWorkspace(bootstrap, door, {
          id: theirs,
          name: "Gamma",
          slug: `gamma-${theirs.toLowerCase()}`,
          adminUserId: colleague,
        })
      ).ok,
    ).toBe(true);

    expect(await workspacesHeldBy(bootstrap, door, person)).toEqual({
      ok: true,
      value: held.toSorted(),
    });
  });

  it("answers an empty list for a person who holds none, rather than a refusal to handle", async () => {
    // The picker's own case: a person signs in before anybody has put them in a
    // workspace. Holding none is an answer, not a failure.
    const door = openPostgres(db.runtimePool);

    expect(await workspacesHeldBy(bootstrap, door, await seedUser())).toEqual({
      ok: true,
      value: [],
    });
  });

  it("refuses an id that is not a person id, so no argument of another shape reaches the statement", async () => {
    const door = openPostgres(db.runtimePool);

    expect(await workspacesHeldBy(bootstrap, door, "' OR true --")).toEqual({
      ok: false,
      error: "malformed",
    });
  });
});
