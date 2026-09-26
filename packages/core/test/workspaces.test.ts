import pg from "pg";
import { describe, expect, expectTypeOf, it } from "vitest";

import { boundarySchemas, ulid } from "@better-answers/schema";
import { testData } from "@better-answers/schema/testing";

import {
  attempt,
  type Claims,
  type OperatorPrincipal,
  type PlatformPrincipal,
  type UserPrincipal,
} from "../src/kernel/index.ts";
import {
  openPostgres,
  type PostgresDoor,
  withOperator,
  withPrincipal,
  withScope,
} from "../src/store/postgres/index.ts";
import {
  addMember,
  correctDisplayName,
  listWorkspaces,
  operatorAddresses,
  personIdByEmail,
  provisionWorkspace,
  readMembership,
  renameWorkspace,
  revokeCredentials,
  revokeWorkspaceTokens,
  setOperatorMark,
  TOOLS_LIST_TTL_CONFIG_KEY,
  TOOLS_LIST_TTL_MS_DEFAULT,
  workspaceIdBySlug,
  workspacesHeldBy,
} from "../src/workspaces/index.ts";
import { endedGrants, issuedCredentialsFor } from "./identity-rows.ts";
import {
  asANewOperator,
  bootstrap,
  personIdOf,
  principalOf,
  provisionedWorkspace,
  seedPerson,
} from "./platform.ts";
import {
  addressOf,
  postgresForSuite,
  readingAs,
  seedingWith,
  whileWritesAreRefused,
} from "./suite-postgres.ts";

const db = postgresForSuite();

const ULID_SHAPE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

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

const identityRowsAbout = async (personId: string) => {
  const found = await db().pool.query(
    "SELECT act, actor, detail FROM identity_audit_event WHERE subject_id = $1 ORDER BY at, id",
    [personId],
  );
  return found.rows;
};

describe("provisioning a workspace", () => {
  it("creates the workspace with partition, first Admin and config row", async () => {
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
    // The MCP transport looks this row up by the literal string; the key read back through
    // its own constant would agree with any name.
    expect(written.rows).toEqual([{ key: "mcp.tools_list_ttl_ms" }]);
  });

  it("writes the platform's provisioning act beside the rows it describes", async () => {
    const adminUserId = await seedUser();
    const door = openPostgres(db().runtimePool);
    const id = ulid();

    const provisioned = await provisionWorkspace(bootstrap, door, {
      id,
      name: "Audited",
      slug: `audited-${id.toLowerCase()}`,
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
        id: expect.stringMatching(ULID_SHAPE),
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

  it("mints the first Admin's membership id, composed from nothing", async () => {
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

  it("leaves nothing, partition included, when the admin does not exist", async () => {
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

  it.each([
    ["empty", ""],
    ["blank", "   "],
  ])(
    "refuses no-display-name when the Admin's name is %s, leaving nothing",
    async (_case, name) => {
      const adminUserId = await seedPerson(db().pool, { name });
      const door = openPostgres(db().runtimePool);
      const id = ulid();

      const provisioned = await provisionWorkspace(bootstrap, door, {
        id,
        name: "Unnamed",
        slug: `unnamed-${id.toLowerCase()}`,
        adminUserId,
      });

      expect(provisioned).toEqual({ ok: false, error: "no-display-name" });
      const row = await db().pool.query("SELECT 1 FROM workspace WHERE id = $1", [id]);
      expect(row.rowCount).toBe(0);
      expect(await partitionExists(id)).toBe(false);
      const memberships = await db().pool.query("SELECT 1 FROM member WHERE user_id = $1", [
        adminUserId,
      ]);
      expect(memberships.rowCount).toBe(0);
      const events = await db().pool.query("SELECT 1 FROM audit_event WHERE workspace_id = $1", [
        id,
      ]);
      expect(events.rowCount).toBe(0);
    },
  );

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

  it("hands back the store's own failure, not an actionable refusal", async () => {
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

describe("revoking a person's credentials everywhere, as the operator", () => {
  const AT = new Date("2026-09-02T12:00:00.000Z");

  const revoking = (input: { personId: string; at: Date }, signedInAt = input.at) =>
    asANewOperator(db(), signedInAt, (operator, tx) =>
      revokeCredentials(operator, tx, { personId: personIdOf(input.personId), at: input.at }),
    );

  const revokedAtOf = async (personId: string) =>
    (await db().pool.query('SELECT credentials_revoked_at FROM "user" WHERE id = $1', [personId]))
      .rows;

  it("ends the earlier sessions and tokens, recorded under the operator", async () => {
    const personId = await seedUser();
    await issuedCredentialsFor(db().pool, personId, {
      sessions: { earlier: "s-old", later: "s-new" },
      refreshTokens: { earlier: "r-old", later: "r-new" },
      accessTokens: { earlier: "a-old", later: "a-new" },
      moments: {
        earlier: new Date("2026-09-02T11:00:00Z"),
        later: new Date("2026-09-02T13:00:00Z"),
      },
    });
    const beforeUpdatedAt =
      (
        await db().pool.query('SELECT updated_at FROM "user" WHERE id = $1', [personId])
      ).rows[0]?.updated_at.getTime() ?? 0;

    const { operatorId, answered } = await revoking({ personId, at: AT });

    expect(answered).toEqual({
      ok: true,
      value: { ok: true, value: { personId, revokedAt: "2026-09-02T12:00:00.000Z" } },
    });
    const after = await db().pool.query(
      'SELECT credentials_revoked_at, updated_at FROM "user" WHERE id = $1',
      [personId],
    );
    expect(after.rows[0]?.credentials_revoked_at).toEqual(AT);
    expect(after.rows[0]?.updated_at.getTime() ?? 0).toBeGreaterThan(beforeUpdatedAt);
    const sessions = await db().pool.query(
      "SELECT id FROM session WHERE user_id = $1 ORDER BY id",
      [personId],
    );
    expect(sessions.rows).toEqual([{ id: "s-new" }]);
    expect(await tokenState("oauth_refresh_token", personId)).toEqual([
      { id: "r-new", revoked: false },
      { id: "r-old", revoked: true },
    ]);
    expect(await tokenState("oauth_access_token", personId)).toEqual([
      { id: "a-new", revoked: false },
      { id: "a-old", revoked: true },
    ]);
    expect(await identityRowsAbout(personId)).toEqual([
      { act: "people.person.credentials_revoked", actor: `human:${operatorId}`, detail: {} },
    ]);
  });

  it("keeps the later instant when asked for an earlier one", async () => {
    const personId = await seedUser();
    await revoking({ personId, at: AT });

    const { answered } = await revoking({ personId, at: new Date("2026-09-02T10:00:00.000Z") });

    expect(answered).toEqual({
      ok: true,
      value: { ok: true, value: { personId, revokedAt: "2026-09-02T12:00:00.000Z" } },
    });
    expect(await revokedAtOf(personId)).toEqual([{ credentials_revoked_at: AT }]);
    expect((await identityRowsAbout(personId)).map((row) => row.act)).toEqual([
      "people.person.credentials_revoked",
      "people.person.credentials_revoked",
    ]);
  });

  it("lands the revocation and its row together, or neither", async () => {
    const personId = await seedUser();

    await expect(
      whileWritesAreRefused(db().pool, "identity_audit_event", () =>
        revoking({ personId, at: AT }),
      ),
    ).rejects.toThrow("the store refused a write to identity_audit_event");
    expect(await revokedAtOf(personId)).toEqual([{ credentials_revoked_at: null }]);
  });

  it("refuses a person who does not exist, writing nothing", async () => {
    const nobody = ulid();

    const { answered } = await revoking({ personId: nobody, at: AT });

    expect(answered).toEqual({ ok: true, value: { ok: false, error: "no-such-user" } });
    expect(await revokedAtOf(nobody)).toEqual([]);
    expect(await identityRowsAbout(nobody)).toEqual([]);
  });

  it("refuses a sign-in over an hour old, ending nothing", async () => {
    const personId = await seedUser();

    const { answered } = await revoking({ personId, at: AT }, new Date("2026-09-02T10:59:59.999Z"));

    expect(answered).toEqual({ ok: true, value: { ok: false, error: "sign-in-too-old" } });
    expect(await revokedAtOf(personId)).toEqual([{ credentials_revoked_at: null }]);
    expect(await identityRowsAbout(personId)).toEqual([]);
  });

  it("admits the operator alone, never an Admin or the platform", () => {
    type Revoker = Parameters<typeof revokeCredentials>[0];

    expectTypeOf<OperatorPrincipal>().toExtend<Revoker>();
    expectTypeOf<UserPrincipal>().not.toExtend<Revoker>();
    expectTypeOf<PlatformPrincipal>().not.toExtend<Revoker>();
  });
});

describe("reading the current membership", () => {
  it("answers the Principal's workspace, person and role", async () => {
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

  it("refuses a session whose workspace or person row is gone", async () => {
    const { door, workspaceId, adminUserId } = await provisionedWorkspace(db(), "Stale");

    const gone = ulid();
    const readAs = (principal: UserPrincipal) =>
      withScope(bootstrap, door, workspaceId, (tx) => readMembership(principal, tx));

    expect(await readAs(principalOf(gone, adminUserId, "Admin"))).toEqual({
      ok: false,
      error: "workspace-gone",
    });
    expect(await readAs(principalOf(workspaceId, gone, "Admin"))).toEqual({
      ok: false,
      error: "person-gone",
    });
  });

  it("reads the role off the Principal, not the member row", async () => {
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

  it("hands back a store failure, and the transaction never commits", async () => {
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

  it("answers a locked person's row as a failure, not person-gone", async () => {
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

    labelById: ReadonlyMap<string, string>;
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
      const labelById = new Map<string, string>();
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
        labelById.set(refresh.id, `refresh ${grant}`);
        labelById.set(access.id, `access ${grant}`);
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
        labelById,
      };
    } finally {
      client.release();
    }
  };

  const endTokens = (input: { workspaceId: string; userId: string; at: Date }) =>
    revokeWorkspaceTokens(bootstrap, openPostgres(db().runtimePool), input);

  it("ends only this workspace's tokens from before the instant", async () => {
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
    expect(await endedGrants(db().pool, seeded)).toEqual(["access here-old", "refresh here-old"]);
  });

  it("never reaches another workspace's tokens, even with a later instant", async () => {
    const seeded = await seedTwoWorkspaces();

    const ended = await endTokens({
      workspaceId: seeded.here,
      userId: seeded.userId,
      at: new Date("2036-01-01T00:00:00Z"),
    });

    expect(ended.ok).toBe(true);

    expect(await endedGrants(db().pool, seeded)).toEqual([
      "access here-new",
      "access here-old",
      "refresh here-new",
      "refresh here-old",
    ]);
  });

  it("ends a token already rotated here, with its access tokens", async () => {
    const seeded = await seedTwoWorkspaces();
    const labelById = new Map(seeded.labelById);
    await seedingWith(db().pool, async (seed) => {
      const rotated = await seed.oauthRefreshToken({
        clientId: seeded.clientId,
        userId: seeded.userId,
        referenceId: seeded.here,
        createdAt: before,
        revoked: before,
        rotatedAt: before,
      });
      const access = await seed.oauthAccessToken({
        clientId: seeded.clientId,
        userId: seeded.userId,
        refreshId: rotated.id,
        createdAt: before,
      });
      labelById.set(rotated.id, "refresh here-rotated");
      labelById.set(access.id, "access of here-rotated");
    });

    await endTokens({ workspaceId: seeded.here, userId: seeded.userId, at });

    expect(await endedGrants(db().pool, { clientId: seeded.clientId, labelById })).toEqual([
      "access here-old",
      "access of here-rotated",
      "refresh here-old",
      "refresh here-rotated",
    ]);
  });

  it("refuses a malformed workspace or person id, ending nothing", async () => {
    const seeded = await seedTwoWorkspaces();

    const malformed = await endTokens({
      workspaceId: "not-a-ulid",
      userId: seeded.userId,
      at,
    });

    expect(malformed).toEqual({ ok: false, error: "malformed" });
    expect(await endedGrants(db().pool, seeded)).toEqual([]);
  });
});

describe("the workspaces a person holds", () => {
  it("answers only that person's workspace ids, in id order", async () => {
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

  it("answers an empty list for a person who holds none", async () => {
    const door = openPostgres(db().runtimePool);

    expect(await workspacesHeldBy(bootstrap, door, await seedUser())).toEqual({
      ok: true,
      value: [],
    });
  });

  it("refuses a malformed person id before the statement", async () => {
    const door = openPostgres(db().runtimePool);

    expect(await workspacesHeldBy(bootstrap, door, "' OR true --")).toEqual({
      ok: false,
      error: "malformed",
    });
  });
});

describe("what the slice answers when the store cannot be reached", () => {
  const at = new Date("2026-09-05T12:00:00Z");

  it("answers the store's Error from every act, never a word", async () => {
    const door = await unreachableDoor();
    const userId = ulid();
    const answers: readonly (readonly [string, unknown])[] = [
      [
        "revokeWorkspaceTokens",
        await revokeWorkspaceTokens(bootstrap, door, { workspaceId: ulid(), userId, at }),
      ],
      ["workspacesHeldBy", await workspacesHeldBy(bootstrap, door, userId)],
      ["workspaceIdBySlug", await workspaceIdBySlug(bootstrap, door, "acme")],
      ["personIdByEmail", await personIdByEmail(bootstrap, door, "acme@example.invalid")],
      [
        "addMember",
        await addMember(bootstrap, door, {
          workspaceId: ulid(),
          email: "acme@example.invalid",
          role: "Editor",
        }),
      ],
      [
        "renameWorkspace",
        await renameWorkspace(bootstrap, door, { workspaceId: ulid(), name: "Acme" }),
      ],
      [
        "setOperatorMark",
        await setOperatorMark(bootstrap, door, { email: "acme@example.invalid", change: "grant" }),
      ],
      ["operatorAddresses", await operatorAddresses(bootstrap, door)],
    ];

    for (const [name, answered] of answers) {
      expect({ name, answered }).toEqual({
        name,
        answered: { ok: false, error: expect.any(Error) },
      });
    }
  });

  const closedTransaction = async () => {
    const closed = await db().runtimePool.connect();
    closed.release(true);
    return closed;
  };

  const operatorSignedInAt = (signedIn: Date): OperatorPrincipal => ({
    kind: "operator",
    userId: boundarySchemas.user.select.shape.id.parse(ulid()),
    credentialIssuedAtMs: signedIn.getTime(),
  });

  it("hands back the store's Error from the operator's acts", async () => {
    const closed = await closedTransaction();
    const operator = operatorSignedInAt(at);

    expect([
      await listWorkspaces(operator, closed),
      await revokeCredentials(operator, closed, { personId: personIdOf(ulid()), at }),
      await correctDisplayName(operator, closed, {
        personId: personIdOf(ulid()),
        displayName: "Sam",
        at,
      }),
    ]).toEqual([
      { ok: false, error: expect.any(Error) },
      { ok: false, error: expect.any(Error) },
      { ok: false, error: expect.any(Error) },
    ]);
  });

  it("refuses what the boundary will not accept before any statement", async () => {
    const door = await unreachableDoor();

    expect(
      await revokeWorkspaceTokens(bootstrap, door, { workspaceId: "not-a-ulid", userId: "x", at }),
    ).toEqual({ ok: false, error: "malformed" });
    expect(await workspacesHeldBy(bootstrap, door, "' OR true --")).toEqual({
      ok: false,
      error: "malformed",
    });
    expect(
      await addMember(bootstrap, door, {
        workspaceId: "not-a-ulid",
        email: "acme@example.invalid",
        role: "Admin",
      }),
    ).toEqual({ ok: false, error: "malformed" });
    for (const input of [
      { workspaceId: "not-a-ulid", name: "Acme" },
      { workspaceId: ulid(), name: "   " },
      { workspaceId: ulid(), slug: "" },
      { workspaceId: ulid() },
    ]) {
      expect({ input, answered: await renameWorkspace(bootstrap, door, input) }).toEqual({
        input,
        answered: { ok: false, error: "malformed" },
      });
    }

    expect(await workspaceIdBySlug(bootstrap, door, "   ")).toEqual({ ok: true, value: undefined });
  });
});

describe("adding a signed-in person as a member, the platform's act", () => {
  const membershipsOf = async (workspaceId: string, userId: string) => {
    const found = await db().pool.query<{ id: string; role: string }>(
      "SELECT id, role FROM member WHERE workspace_id = $1 AND user_id = $2",
      [workspaceId, userId],
    );
    return found.rows;
  };

  const addedRowsOf = async (workspaceId: string) => {
    const found = await db().pool.query(
      "SELECT id, act, family, actor, subject_kind, subject_id, detail, batch_id FROM audit_event WHERE workspace_id = $1 AND act = 'people.member.added' ORDER BY at, id",
      [workspaceId],
    );
    return found.rows;
  };

  const memberCountOf = async (workspaceId: string): Promise<string> => {
    const found = await db().pool.query<{ members: string }>(
      "SELECT count(*) AS members FROM member WHERE workspace_id = $1",
      [workspaceId],
    );
    return found.rows[0]?.members ?? "";
  };

  const signedIn = async (): Promise<{ email: string; userId: string }> => {
    const email = addressOf("member");
    return { email, userId: await seedPerson(db().pool, { email }) };
  };

  it.each(["Admin", "Editor", "Viewer"] as const)(
    "makes a signed-in person a %s by email, however cased",
    async (role) => {
      const { door, workspaceId } = await provisionedWorkspace(db(), "Joined");
      const { email, userId } = await signedIn();

      const added = await addMember(bootstrap, door, {
        workspaceId,
        email: email.toUpperCase(),
        role,
      });

      expect(added).toEqual({
        ok: true,
        value: { workspaceId, userId, role, actorId: "process:better-answers-bootstrap" },
      });
      const rows = await membershipsOf(workspaceId, userId);
      expect(rows).toEqual([{ id: expect.stringMatching(ULID_SHAPE), role }]);
      expect(rows[0]?.id).not.toContain(workspaceId);
      expect(rows[0]?.id).not.toContain(userId);
      const resolved = await withPrincipal(
        door,
        { workspaceId, userId, issuedAt: new Date() },
        async (principal) => principal.role,
      );
      expect(resolved).toEqual({ ok: true, value: role });
    },
  );

  it("writes one people.member.added row to the workspace's own audit log", async () => {
    const { door, workspaceId } = await provisionedWorkspace(db(), "Audited");
    const { email, userId } = await signedIn();

    await addMember(bootstrap, door, { workspaceId, email, role: "Editor" });

    expect(await addedRowsOf(workspaceId)).toEqual([
      {
        id: expect.stringMatching(ULID_SHAPE),
        act: "people.member.added",
        family: "people",
        actor: "process:better-answers-bootstrap",
        subject_kind: "member",
        subject_id: userId,
        detail: { userId, role: "Editor" },
        batch_id: null,
      },
    ]);
  });

  it("writes the membership and its audit event together, or neither", async () => {
    const { door, workspaceId } = await provisionedWorkspace(db(), "Atomic");
    const { email, userId } = await signedIn();

    const added = await whileWritesAreRefused(db().pool, "audit_event", () =>
      addMember(bootstrap, door, { workspaceId, email, role: "Viewer" }),
    );

    expect(added).toMatchObject({ ok: false, error: expect.any(Error) });
    expect(await membershipsOf(workspaceId, userId)).toEqual([]);
  });

  it("refuses a missing workspace, an unknown person, an existing member", async () => {
    const admin = { name: "Priya Shah", email: addressOf("priya") };
    const { door, workspaceId, adminUserId } = await provisionedWorkspace(db(), "Refusing", admin);
    const { email } = await signedIn();

    const refusals = [
      await addMember(bootstrap, door, { workspaceId: ulid(), email, role: "Editor" }),
      await addMember(bootstrap, door, { workspaceId, email: addressOf("nobody"), role: "Editor" }),
      await addMember(bootstrap, door, { workspaceId, email: admin.email, role: "Editor" }),
    ];

    expect(refusals).toEqual([
      { ok: false, error: "no-such-workspace" },
      { ok: false, error: "no-such-user" },
      { ok: false, error: "already-a-member" },
    ]);
    expect(await memberCountOf(workspaceId)).toBe("1");
    expect(await membershipsOf(workspaceId, adminUserId)).toEqual([
      { id: expect.stringMatching(ULID_SHAPE), role: "Admin" },
    ]);
    expect(await addedRowsOf(workspaceId)).toEqual([]);
  });

  it.each([
    ["empty", ""],
    ["blank", "   "],
  ])(
    "refuses no-display-name when the person's name is %s, writing nothing",
    async (_case, name) => {
      const { door, workspaceId } = await provisionedWorkspace(db(), "Unnamed");
      const email = addressOf("unnamed");
      const userId = await seedPerson(db().pool, { email, name });

      const added = await addMember(bootstrap, door, { workspaceId, email, role: "Editor" });

      expect(added).toEqual({ ok: false, error: "no-display-name" });
      expect(await membershipsOf(workspaceId, userId)).toEqual([]);
      expect(await addedRowsOf(workspaceId)).toEqual([]);
    },
  );

  it("refuses a repeat add rather than changing the role", async () => {
    const { door, workspaceId } = await provisionedWorkspace(db(), "Repeated");
    const { email, userId } = await signedIn();
    const first = await addMember(bootstrap, door, { workspaceId, email, role: "Editor" });
    expect(first.ok).toBe(true);

    const again = await addMember(bootstrap, door, { workspaceId, email, role: "Admin" });

    expect(again).toEqual({ ok: false, error: "already-a-member" });
    expect((await membershipsOf(workspaceId, userId)).map((row) => row.role)).toEqual(["Editor"]);
    expect(await addedRowsOf(workspaceId)).toHaveLength(1);
  });

  it("is not reachable from a workspace Admin's own principal", () => {
    const door = openPostgres(db().runtimePool);
    const admin = principalOf(ulid(), ulid(), "Admin");

    // @ts-expect-error a user principal is not a platform principal
    void (() => addMember(admin, door, { workspaceId: ulid(), email: "a@b.c", role: "Editor" }));
    expect(admin.role).toBe("Admin");
  });
});

describe("renaming a workspace — the platform's act", () => {
  const standingOf = async (workspaceId: string) => {
    const found = await db().pool.query<{ name: string; slug: string }>(
      "SELECT name, slug FROM workspace WHERE id = $1",
      [workspaceId],
    );
    return found.rows;
  };

  const renamedRowsOf = async (workspaceId: string) => {
    const found = await db().pool.query(
      "SELECT id, act, family, actor, subject_kind, subject_id, detail, batch_id FROM audit_event WHERE workspace_id = $1 AND act = 'platform.workspace.renamed' ORDER BY at, id",
      [workspaceId],
    );
    return found.rows;
  };

  it("sets both, answering the standing and recording one row", async () => {
    const { door, workspaceId } = await provisionedWorkspace(db(), "Acme");
    const slug = `group-${workspaceId.toLowerCase()}`;

    const renamed = await renameWorkspace(bootstrap, door, {
      workspaceId,
      name: "  Acme Group ",
      slug,
    });

    expect(renamed).toEqual({
      ok: true,
      value: {
        workspaceId,
        name: "Acme Group",
        slug,
        actorId: "process:better-answers-bootstrap",
      },
    });
    expect(await standingOf(workspaceId)).toEqual([{ name: "Acme Group", slug }]);
    expect(await renamedRowsOf(workspaceId)).toEqual([
      {
        id: expect.stringMatching(ULID_SHAPE),
        act: "platform.workspace.renamed",
        family: "platform",
        actor: "process:better-answers-bootstrap",
        subject_kind: "workspace",
        subject_id: workspaceId,
        detail: { nameChanged: true, slugChanged: true },
        batch_id: null,
      },
    ]);
  });

  it("keeps an omitted field, recording only the other as changed", async () => {
    const named = await provisionedWorkspace(db(), "Named");
    const slugged = await provisionedWorkspace(db(), "Slugged");
    const newSlug = `moved-${slugged.workspaceId.toLowerCase()}`;

    await renameWorkspace(bootstrap, named.door, {
      workspaceId: named.workspaceId,
      name: "Named Again",
    });
    await renameWorkspace(bootstrap, slugged.door, {
      workspaceId: slugged.workspaceId,
      slug: newSlug,
    });

    expect({
      named: await standingOf(named.workspaceId),
      slugged: await standingOf(slugged.workspaceId),
    }).toEqual({
      named: [{ name: "Named Again", slug: named.slug }],
      slugged: [{ name: "Slugged", slug: newSlug }],
    });
    expect({
      named: (await renamedRowsOf(named.workspaceId)).map((row) => row.detail),
      slugged: (await renamedRowsOf(slugged.workspaceId)).map((row) => row.detail),
    }).toEqual({
      named: [{ nameChanged: true, slugChanged: false }],
      slugged: [{ nameChanged: false, slugChanged: true }],
    });
  });

  it("writes nothing when the input changes neither field", async () => {
    const { door, workspaceId, slug } = await provisionedWorkspace(db(), "Same");

    const renamed = await renameWorkspace(bootstrap, door, { workspaceId, name: "Same", slug });

    expect(renamed).toEqual({
      ok: true,
      value: { workspaceId, name: "Same", slug, actorId: "process:better-answers-bootstrap" },
    });
    expect(await renamedRowsOf(workspaceId)).toEqual([]);
  });

  it("refuses slug-taken and no-such-workspace, writing nothing", async () => {
    const holder = await provisionedWorkspace(db(), "Holder");
    const { door, workspaceId, slug } = await provisionedWorkspace(db(), "Taker");

    const refusals = [
      await renameWorkspace(bootstrap, door, {
        workspaceId,
        name: "Taker Again",
        slug: holder.slug,
      }),
      await renameWorkspace(bootstrap, door, { workspaceId: ulid(), name: "Nowhere" }),
    ];

    expect(refusals).toEqual([
      { ok: false, error: "slug-taken" },
      { ok: false, error: "no-such-workspace" },
    ]);
    expect(await standingOf(workspaceId)).toEqual([{ name: "Taker", slug }]);
    expect(await renamedRowsOf(workspaceId)).toEqual([]);
  });

  it("renames and records together, or neither", async () => {
    const { door, workspaceId, slug } = await provisionedWorkspace(db(), "Atomic");

    const renamed = await whileWritesAreRefused(db().pool, "audit_event", () =>
      renameWorkspace(bootstrap, door, { workspaceId, name: "Atomic Again" }),
    );

    expect(renamed).toMatchObject({ ok: false, error: expect.any(Error) });
    expect(await standingOf(workspaceId)).toEqual([{ name: "Atomic", slug }]);
  });
});

describe("the person behind an email", () => {
  it("answers the id for an email however cased, or nothing", async () => {
    const door = openPostgres(db().runtimePool);
    const email = addressOf("casey");
    const userId = await seedPerson(db().pool, { email });

    expect(await personIdByEmail(bootstrap, door, email.toUpperCase())).toEqual({
      ok: true,
      value: userId,
    });
    expect(await personIdByEmail(bootstrap, door, addressOf("nobody"))).toEqual({
      ok: true,
      value: undefined,
    });
  });
});

describe("the operator mark, set and cleared by the platform", () => {
  const markOf = async (personId: string) => {
    const found = await db().pool.query<{ operator: boolean }>(
      'SELECT operator FROM "user" WHERE id = $1',
      [personId],
    );
    return found.rows[0]?.operator;
  };

  const marking = (email: string, change: "grant" | "revoke") =>
    setOperatorMark(bootstrap, openPostgres(db().runtimePool), { email, change });

  it("sets the mark by address, recorded under the platform's actor", async () => {
    const email = addressOf("owner");
    const personId = await seedPerson(db().pool, { email });

    const marked = await marking(email.toUpperCase(), "grant");

    expect(marked).toEqual({ ok: true, value: { personId, changed: true } });
    expect(await markOf(personId)).toBe(true);
    expect(await identityRowsAbout(personId)).toEqual([
      { act: "people.operator.granted", actor: "process:better-answers-bootstrap", detail: {} },
    ]);
  });

  it("clears the mark, recording the clearing as its own act", async () => {
    const email = addressOf("leaver");
    const personId = await seedPerson(db().pool, { email, operator: true });

    const cleared = await marking(email, "revoke");

    expect(cleared.ok && cleared.value.changed).toBe(true);
    expect(await markOf(personId)).toBe(false);
    expect(await identityRowsAbout(personId)).toEqual([
      { act: "people.operator.revoked", actor: "process:better-answers-bootstrap", detail: {} },
    ]);
  });

  it("writes nothing for a person already standing as asked", async () => {
    const plain = addressOf("plain");
    const marked = addressOf("marked");
    const plainId = await seedPerson(db().pool, { email: plain });
    const markedId = await seedPerson(db().pool, { email: marked, operator: true });

    const answers = [await marking(plain, "revoke"), await marking(marked, "grant")];

    expect(answers.map((answer) => answer.ok && answer.value.changed)).toEqual([false, false]);
    expect([await markOf(plainId), await markOf(markedId)]).toEqual([false, true]);
    expect([...(await identityRowsAbout(plainId)), ...(await identityRowsAbout(markedId))]).toEqual(
      [],
    );
  });

  it("refuses an address nobody has signed in with", async () => {
    expect(await marking(addressOf("nobody"), "grant")).toEqual({
      ok: false,
      error: "no-such-user",
    });
  });

  it("names every marked person's address, and no one else's", async () => {
    const first = `a-${addressOf("first")}`;
    const second = `b-${addressOf("second")}`;
    const cleared = addressOf("cleared");
    const plain = addressOf("plain");
    for (const email of [first, second, cleared, plain]) await seedPerson(db().pool, { email });
    for (const email of [second, first, cleared]) await marking(email, "grant");
    await marking(cleared, "revoke");

    const read = await operatorAddresses(bootstrap, openPostgres(db().runtimePool));

    const addresses = read.ok ? read.value : [];
    const ours = addresses.filter((email) => [first, second, cleared, plain].includes(email));
    expect(ours).toEqual([first, second]);
  });
});

describe("the operator's list of every workspace", () => {
  it("names each workspace with its slug, members and creation", async () => {
    const acme = await provisionedWorkspace(db(), "Acme");
    const second = addressOf("second");
    await seedPerson(db().pool, { email: second });
    await addMember(bootstrap, acme.door, {
      workspaceId: acme.workspaceId,
      email: second,
      role: "Viewer",
    });
    const operatorId = await seedPerson(db().pool, { operator: true });

    const listed = await withOperator(
      acme.door,
      { userId: operatorId, issuedAt: new Date() },
      (operator, tx) => listWorkspaces(operator, tx),
    );

    const workspaces = listed.ok && listed.value.ok ? listed.value.value : [];
    expect(workspaces.find((workspace) => workspace.id === acme.workspaceId)).toEqual({
      id: acme.workspaceId,
      name: "Acme",
      slug: `acme-${acme.workspaceId.toLowerCase()}`,
      memberCount: 2,
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });
  });
});
