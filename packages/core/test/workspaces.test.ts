import { type MigratedPostgres, startMigratedPostgres, testData, ulid } from "@better-answers/schema/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PlatformPrincipal } from "../src/kernel/index.ts";
import { openPostgres, withPrincipal } from "../src/store/postgres/index.ts";
import {
  provisionWorkspace,
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

const bootstrap: PlatformPrincipal = { kind: "platform", actorId: "process:better-answers-bootstrap" };

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

    const first = await provisionWorkspace(bootstrap, door, { id: ulid(), name: "One", slug, adminUserId });
    const second = await provisionWorkspace(bootstrap, door, { id: ulid(), name: "Two", slug, adminUserId });

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
