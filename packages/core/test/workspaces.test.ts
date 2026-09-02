import {
  type MigratedPostgres,
  startMigratedPostgres,
  testData,
  ulid,
} from "@better-answers/schema/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PlatformPrincipal } from "../src/kernel/index.ts";
import { openPostgres, withPrincipal } from "../src/store/postgres/index.ts";
import {
  provisionWorkspace,
  revokeCredentials,
  TOOLS_LIST_TTL_CONFIG_KEY,
  TOOLS_LIST_TTL_MS_DEFAULT,
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

  it("leaves nothing behind when the admin does not exist — no workspace without its partition", async () => {
    const door = openPostgres(db.runtimePool);
    const id = ulid();

    const provisioned = await provisionWorkspace(bootstrap, door, {
      id,
      name: "Ghost",
      slug: `ghost-${id.toLowerCase()}`,
      adminUserId: "user-who-does-not-exist",
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
});
