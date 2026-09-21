import { testData } from "@better-answers/schema/testing";
import pg from "pg";
import { describe, expect, it } from "vitest";

import { boundarySchemas, ulid } from "@better-answers/schema";

import { attempt, type Claims, type UserPrincipal } from "../src/kernel/index.ts";
import { bootstrap, principalOf, provisionedWorkspace, seedPerson } from "./platform.ts";
import {
  openPostgres,
  type PostgresDoor,
  withPrincipal,
  withScope,
} from "../src/store/postgres/index.ts";
import {
  provisionWorkspace,
  readMembership,
  revokeCredentials,
  revokeWorkspaceTokens,
  TOOLS_LIST_TTL_CONFIG_KEY,
  TOOLS_LIST_TTL_MS_DEFAULT,
  workspaceIdBySlug,
  workspacesHeldBy,
} from "../src/workspaces/index.ts";
import { postgresForSuite, readingAs } from "./suite-postgres.ts";

const db = postgresForSuite();

const seedUser = (): Promise<string> => seedPerson(db().pool);

const partitionExists = async (workspaceId: string): Promise<boolean> => {
  const found = await db().pool.query(
    "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'index' AND c.relname = $1",
    [`chunk_${workspaceId}`],
  );
  return found.rowCount === 1;
};

const unreachableDoor = async (): Promise<PostgresDoor> => {
  const gone = new pg.Pool(db().runtimePool.options);
  await gone.end();
  return openPostgres(gone);
};

const tokenState = async (
  table: "oauth_refresh_token" | "oauth_access_token",
  userId: string,
): Promise<readonly { id: string; revoked: boolean }[]> => {
  const rows = await db().pool.query<{ id: string; revoked: boolean }>(
    `SELECT id, revoked IS NOT NULL AS revoked FROM ${table} WHERE user_id = $1 ORDER BY id`,
    [userId],
  );
  return rows.rows;
};

describe("provisioning a workspace", () => {
  it("creates the workspace, its chunk partition, its first Admin and its config row in one act", async () => {
    const adminUserId = await seedUser();
    const door = openPostgres(db().runtimePool);
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

    const written = await db().pool.query<{ key: string }>(
      "SELECT key FROM workspace_config WHERE workspace_id = $1",
      [id],
    );
    // The written-down name, never the constant that wrote it: read back through that, this
    // would agree with any name.
    expect(written.rows).toEqual([{ key: "mcp.tools_list_ttl_ms" }]);
  });

  it("writes the first act on the ledger beside the rows it describes — the platform's, in the workspace it created", async () => {
    const adminUserId = await seedUser();
    const door = openPostgres(db().runtimePool);
    const id = ulid();

    const provisioned = await provisionWorkspace(bootstrap, door, {
      id,
      name: "Ledgered",
      slug: `ledgered-${id.toLowerCase()}`,
      adminUserId,
    });

    expect(provisioned.ok).toBe(true);

    const beside = await db().pool.query<{ rows: string }>(
      `SELECT (SELECT count(*) FROM workspace WHERE id = $1)
            + (SELECT count(*) FROM member WHERE workspace_id = $1)
            + (SELECT count(*) FROM workspace_config WHERE workspace_id = $1) AS rows`,
      [id],
    );
    expect(beside.rows[0]?.rows).toBe("3");
    expect(await partitionExists(id)).toBe(true);
    const events = await db().pool.query<{ id: string }>(
      "SELECT id, act, family, actor, subject_kind, subject_id, detail, batch_id FROM audit_event WHERE workspace_id = $1",
      [id],
    );

    expect(events.rows).toEqual([
      {
        id: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
        act: "platform.workspace.provisioned",
        family: "platform",
        actor: "process:better-answers-bootstrap",
        subject_kind: "workspace",
        subject_id: id,
        detail: { adminUserId, role: "Admin" },
        batch_id: null,
      },
    ]);
  });

  it("gives the first Admin's membership an id in the one shape the platform mints, composed from nothing", async () => {
    const adminUserId = await seedUser();
    const door = openPostgres(db().runtimePool);
    const id = ulid();

    await provisionWorkspace(bootstrap, door, {
      id,
      name: "Minted",
      slug: `minted-${id.toLowerCase()}`,
      adminUserId,
    });

    const row = await db().pool.query<{ id: string }>(
      "SELECT id FROM member WHERE workspace_id = $1 AND user_id = $2",
      [id, adminUserId],
    );
    const memberId = row.rows[0]?.id;
    expect(boundarySchemas.member.select.shape.id.safeParse(memberId).success).toBe(true);

    expect(memberId).not.toContain(id);
    expect(memberId).not.toContain(adminUserId);
  });

  it("leaves nothing behind when the admin does not exist — no workspace without its partition", async () => {
    const door = openPostgres(db().runtimePool);
    const id = ulid();

    const provisioned = await provisionWorkspace(bootstrap, door, {
      id,
      name: "Ghost",
      slug: `ghost-${id.toLowerCase()}`,

      adminUserId: ulid(),
    });

    expect(provisioned).toEqual({ ok: false, error: "no-such-user" });
    const row = await db().pool.query("SELECT 1 FROM workspace WHERE id = $1", [id]);
    expect(row.rowCount).toBe(0);
    expect(await partitionExists(id)).toBe(false);

    const events = await db().pool.query("SELECT 1 FROM audit_event WHERE workspace_id = $1", [id]);
    expect(events.rowCount).toBe(0);
  });

  it("refuses a slug another workspace already holds", async () => {
    const adminUserId = await seedUser();
    const door = openPostgres(db().runtimePool);
    const slug = `taken-${ulid().toLowerCase()}`;

    const first = await provisionWorkspace(bootstrap, door, {
      id: ulid(),
      name: "One",
      slug,
      adminUserId,
    });
    const secondId = ulid();
    const second = await provisionWorkspace(bootstrap, door, {
      id: secondId,
      name: "Two",
      slug,
      adminUserId,
    });

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, error: "slug-taken" });

    const events = await db().pool.query("SELECT 1 FROM audit_event WHERE subject_id = $1", [
      secondId,
    ]);
    expect(events.rowCount).toBe(0);
  });

  it("refuses an id a workspace already holds", async () => {
    const adminUserId = await seedUser();
    const door = openPostgres(db().runtimePool);
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
    const door = openPostgres(db().runtimePool);

    const provisioned = await provisionWorkspace(bootstrap, door, {
      id: "not-a-ulid",
      name: "Bad",
      slug: "bad",
      adminUserId: await seedUser(),
    });

    expect(provisioned).toEqual({ ok: false, error: "malformed" });
  });

  it("hands a caller the store's own failure rather than a refusal it could act on", async () => {
    const provisioned = await provisionWorkspace(bootstrap, await unreachableDoor(), {
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
    const door = openPostgres(db().runtimePool);
    const id = ulid();
    await provisionWorkspace(bootstrap, door, {
      id,
      name: "Acme",
      slug: `acme-${id.toLowerCase()}`,
      adminUserId,
    });
    const at = new Date("2026-09-02T12:00:00Z");

    const superuser = await db().pool.connect();
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

      for (const [tokenId, createdAt] of [
        ["a-old", new Date("2026-09-02T11:00:00Z")],
        ["a-new", new Date("2026-09-02T13:00:00Z")],
      ] as const) {
        await testData(superuser).oauthAccessToken({
          id: tokenId,
          clientId: "https://c.example/x",
          userId: adminUserId,
          createdAt,
        });
      }
    } finally {
      superuser.release();
    }

    const beforeUpdatedAt =
      (
        await db().pool.query('SELECT updated_at FROM "user" WHERE id = $1', [adminUserId])
      ).rows[0]?.updated_at.getTime() ?? 0;

    const revoked = await revokeCredentials(bootstrap, door, { userId: adminUserId, at });

    expect(revoked).toEqual({
      ok: true,
      value: { userId: adminUserId, actorId: "process:better-answers-bootstrap" },
    });
    const after = await db().pool.query(
      'SELECT credentials_revoked_at, updated_at FROM "user" WHERE id = $1',
      [adminUserId],
    );
    expect(after.rows[0]?.credentials_revoked_at).toEqual(at);
    expect(after.rows[0]?.updated_at.getTime() ?? 0).toBeGreaterThan(beforeUpdatedAt);
    const sessions = await db().pool.query(
      "SELECT id FROM session WHERE user_id = $1 ORDER BY id",
      [adminUserId],
    );
    expect(sessions.rows).toEqual([{ id: "s-new" }]);
    expect(await tokenState("oauth_refresh_token", adminUserId)).toEqual([
      { id: "r-new", revoked: false },
      { id: "r-old", revoked: true },
    ]);
    expect(await tokenState("oauth_access_token", adminUserId)).toEqual([
      { id: "a-new", revoked: false },
      { id: "a-old", revoked: true },
    ]);

    const earlier = await revokeCredentials(bootstrap, door, {
      userId: adminUserId,
      at: new Date("2026-09-02T10:00:00Z"),
    });
    expect(earlier.ok).toBe(true);
    const kept = await db().pool.query('SELECT credentials_revoked_at FROM "user" WHERE id = $1', [
      adminUserId,
    ]);
    expect(kept.rows[0]?.credentials_revoked_at).toEqual(at);
  });

  it("refuses a person who does not exist and leaves nothing behind", async () => {
    const door = openPostgres(db().runtimePool);
    const revoked = await revokeCredentials(bootstrap, door, {
      userId: "user-missing",
      at: new Date(),
    });
    expect(revoked).toEqual({ ok: false, error: "no-such-user" });

    const nobody = ulid();
    expect(await revokeCredentials(bootstrap, door, { userId: nobody, at: new Date() })).toEqual({
      ok: false,
      error: "no-such-user",
    });
    const person = await db().pool.query('SELECT 1 FROM "user" WHERE id = $1', [nobody]);
    expect(person.rowCount).toBe(0);
  });

  it("is not reachable from a workspace Admin's own principal", () => {
    const door = openPostgres(db().runtimePool);
    const admin: UserPrincipal = {
      kind: "user",
      workspaceId: ulid() as UserPrincipal["workspaceId"],
      userId: "user-admin" as UserPrincipal["userId"],
      role: "Admin",
      groups: [],
      credentialIssuedAtMs: Date.now(),
    };

    // @ts-expect-error a user principal is not a platform principal
    void (() => revokeCredentials(admin, door, { userId: admin.userId, at: new Date() }));
    expect(admin.role).toBe("Admin");
  });
});

describe("reading the current membership", () => {
  it("answers the workspace the Principal names, the person it names, and the role it carries", async () => {
    const here = await provisionedWorkspace(db(), "Acme", {
      name: "Priya Shah",
      email: "priya@example.invalid",
    });

    const there = await provisionedWorkspace(db(), "Beta");
    const client = await db().pool.connect();
    try {
      await testData(client).member({
        workspaceId: there.workspaceId,
        userId: here.adminUserId,
        role: "Viewer",
      });
    } finally {
      client.release();
    }
    const readIn = (workspaceId: string) =>
      readingAs(db().runtimePool, { workspaceId, userId: here.adminUserId }, readMembership);

    expect(await readIn(here.workspaceId)).toEqual({
      ok: true,
      value: {
        workspace: { id: here.workspaceId, name: "Acme" },
        person: { id: here.adminUserId, name: "Priya Shah", email: "priya@example.invalid" },
        role: "Admin",
      },
    });
    expect(await readIn(there.workspaceId)).toEqual({
      ok: true,
      value: {
        workspace: { id: there.workspaceId, name: "Beta" },
        person: { id: here.adminUserId, name: "Priya Shah", email: "priya@example.invalid" },
        role: "Viewer",
      },
    });
  });

  it("refuses a session pointing at a workspace or a person whose row is gone", async () => {
    const { door, workspaceId, adminUserId } = await provisionedWorkspace(db(), "Stale");

    const gone = ulid();
    const readAs = (principal: UserPrincipal) =>
      withScope(bootstrap, door, workspaceId, (tx) => readMembership(principal, tx));

    expect(await readAs(principalOf(gone, adminUserId, "Admin"))).toEqual({
      ok: false,
      error: "no-such-workspace",
    });
    expect(await readAs(principalOf(workspaceId, gone, "Admin"))).toEqual({
      ok: false,
      error: "no-such-person",
    });
  });

  it("reads the role off the Principal rather than the member row, which the resolver already held", async () => {
    const { door, workspaceId } = await provisionedWorkspace(db(), "Trusted");
    const stranger = await seedPerson(db().pool, {
      name: "Sam Okoro",
      email: "stranger@example.invalid",
    });

    const read = await withScope(bootstrap, door, workspaceId, (tx) =>
      readMembership(principalOf(workspaceId, stranger, "Editor"), tx),
    );

    expect(read).toEqual({
      ok: true,
      value: {
        workspace: { id: workspaceId, name: "Trusted" },
        person: { id: stranger, name: "Sam Okoro", email: "stranger@example.invalid" },
        role: "Editor",
      },
    });
  });

  it("hands a caller a store failure to read, and the aborted transaction never commits", async () => {
    const adminUserId = await seedUser();
    const door = openPostgres(db().runtimePool);
    const id = ulid();
    const provisioned = await provisionWorkspace(bootstrap, door, {
      id,
      name: "Shell",
      slug: `shell-${id.toLowerCase()}`,
      adminUserId,
    });
    expect(provisioned.ok).toBe(true);

    const claims: Claims = { workspaceId: id, userId: adminUserId, issuedAt: new Date() };
    let read: Awaited<ReturnType<typeof readMembership>> | undefined;

    await expect(
      withPrincipal(door, claims, async (principal, tx) => {
        await attempt(() => tx.query("SELECT no_such_function()"));
        read = await readMembership(principal, tx);
      }),
    ).rejects.toThrow(/did not commit/);

    expect(read).toMatchObject({ ok: false, error: expect.any(Error) });
  });

  it("reads a failure of the person's row as the store's, never as a person who is not there", async () => {
    const { door, workspaceId, adminUserId } = await provisionedWorkspace(db(), "Held");
    const holder = await db().pool.connect();
    let read: Awaited<ReturnType<typeof readMembership>> | undefined;

    try {
      await holder.query('BEGIN; LOCK TABLE "user" IN ACCESS EXCLUSIVE MODE');
      await expect(
        withScope(bootstrap, door, workspaceId, async (tx) => {
          await tx.query("SET LOCAL lock_timeout = '200ms'");
          read = await readMembership(principalOf(workspaceId, adminUserId, "Admin"), tx);
        }),
      ).rejects.toThrow(/did not commit/);
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }

    expect(read).toMatchObject({ ok: false, error: expect.any(Error) });
  });
});

describe("revoking a person's tokens in one workspace", () => {
  const at = new Date("2026-09-04T12:00:00Z");
  const before = new Date("2026-09-04T11:00:00Z");
  const after = new Date("2026-09-04T13:00:00Z");

  type Seeded = {
    here: string;
    there: string;
    userId: string;
    clientId: string;

    grants: ReadonlyMap<string, string>;
  };

  const seedTwoWorkspaces = async (): Promise<Seeded> => {
    const client = await db().pool.connect();
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

  const endTokens = (input: { workspaceId: string; userId: string; at: Date }) =>
    revokeWorkspaceTokens(bootstrap, openPostgres(db().runtimePool), input);

  const endedGrants = async (seeded: Seeded): Promise<readonly string[]> => {
    const rows = await db().pool.query<{ id: string }>(
      `SELECT id FROM oauth_refresh_token WHERE client_id = $1 AND revoked IS NOT NULL
       UNION ALL
       SELECT id FROM oauth_access_token WHERE client_id = $1 AND revoked IS NOT NULL`,
      [seeded.clientId],
    );
    return rows.rows.map((row) => seeded.grants.get(row.id) ?? row.id).toSorted();
  };

  it("ends the refresh and access tokens consented to this workspace before the instant, and no others", async () => {
    const seeded = await seedTwoWorkspaces();

    const ended = await endTokens({ workspaceId: seeded.here, userId: seeded.userId, at });

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

    const ended = await endTokens({
      workspaceId: seeded.here,
      userId: seeded.userId,
      at: new Date("2036-01-01T00:00:00Z"),
    });

    expect(ended.ok).toBe(true);

    expect(await endedGrants(seeded)).toEqual([
      "access here-new",
      "access here-old",
      "refresh here-new",
      "refresh here-old",
    ]);
  });

  it("refuses a workspace id or a person id that is not one, and ends nothing", async () => {
    const seeded = await seedTwoWorkspaces();

    const malformed = await endTokens({
      workspaceId: "not-a-ulid",
      userId: seeded.userId,
      at,
    });

    expect(malformed).toEqual({ ok: false, error: "malformed" });
    expect(await endedGrants(seeded)).toEqual([]);
  });
});

describe("the workspaces a person holds", () => {
  it("answers that person's workspace ids in id order, and nothing about anybody else", async () => {
    const door = openPostgres(db().runtimePool);
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
    const door = openPostgres(db().runtimePool);

    expect(await workspacesHeldBy(bootstrap, door, await seedUser())).toEqual({
      ok: true,
      value: [],
    });
  });

  it("refuses an id that is not a person id, so no argument of another shape reaches the statement", async () => {
    const door = openPostgres(db().runtimePool);

    expect(await workspacesHeldBy(bootstrap, door, "' OR true --")).toEqual({
      ok: false,
      error: "malformed",
    });
  });
});

describe("what the slice answers when the store cannot be reached", () => {
  const at = new Date("2026-09-05T12:00:00Z");

  it("hands back the store's Error from every act, rather than a word or a partial answer", async () => {
    const door = await unreachableDoor();
    const userId = ulid();
    const answers: readonly (readonly [string, unknown])[] = [
      ["revokeCredentials", await revokeCredentials(bootstrap, door, { userId, at })],
      [
        "revokeWorkspaceTokens",
        await revokeWorkspaceTokens(bootstrap, door, { workspaceId: ulid(), userId, at }),
      ],
      ["workspacesHeldBy", await workspacesHeldBy(bootstrap, door, userId)],
      ["workspaceIdBySlug", await workspaceIdBySlug(bootstrap, door, "acme")],
    ];

    for (const [name, answered] of answers) {
      expect({ name, answered }).toEqual({
        name,
        answered: { ok: false, error: expect.any(Error) },
      });
    }
  });

  it("refuses an argument the boundary will not accept before it reaches for a statement", async () => {
    const door = await unreachableDoor();

    expect(await revokeCredentials(bootstrap, door, { userId: "not-a-ulid", at })).toEqual({
      ok: false,
      error: "no-such-user",
    });
    expect(
      await revokeWorkspaceTokens(bootstrap, door, { workspaceId: "not-a-ulid", userId: "x", at }),
    ).toEqual({ ok: false, error: "malformed" });
    expect(await workspacesHeldBy(bootstrap, door, "' OR true --")).toEqual({
      ok: false,
      error: "malformed",
    });

    expect(await workspaceIdBySlug(bootstrap, door, "   ")).toEqual({ ok: true, value: undefined });
  });
});
