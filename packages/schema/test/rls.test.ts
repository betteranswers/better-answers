import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { declaredTableNames } from "../scripts/worker-view.ts";
import { testData } from "./factory.ts";
import { type MigratedPostgres, startMigratedPostgres, withRollback } from "./harness.ts";

/**
 * The isolation proofs ADR 0032 names: a missing scope (empty GUC) returns zero rows,
 * never another tenant's — once at the seam function, once through each tenant table —
 * and the one SECURITY DEFINER lifecycle function is the only runtime-DDL path.
 * Seeding runs through the factory as the container's superuser (which bypasses RLS by
 * design); every assertion runs as `app_rt`.
 */

let db: MigratedPostgres;

beforeAll(async () => {
  db = await startMigratedPostgres();
}, 120_000);

afterAll(async () => {
  await db.stop();
});

const WS_A = "01J6AAAAAAAAAAAAAAAAAAAAAA";
const WS_B = "01J6BBBBBBBBBBBBBBBBBBBBBB";

const seedTwoWorkspaces = async (client: pg.PoolClient) => {
  const seed = testData(client);
  await seed.workspace({ id: WS_A, name: "A" });
  await seed.workspace({ id: WS_B, name: "B" });
  return seed;
};

describe("the seam function", () => {
  it("returns NULL when no scope was set, and NULL on an empty one", async () => {
    await withRollback(db.pool, async (client) => {
      const unset = await client.query("SELECT current_workspace_id() AS ws");
      expect(unset.rows[0]?.ws).toBeNull();

      await client.query("SELECT set_config('app.workspace_id', '', true)");
      const empty = await client.query("SELECT current_workspace_id() AS ws");
      expect(empty.rows[0]?.ws).toBeNull();
    });
  });

  it("returns the workspace the transaction set", async () => {
    await withRollback(db.pool, async (client) => {
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      const set = await client.query("SELECT current_workspace_id() AS ws");
      expect(set.rows[0]?.ws).toBe(WS_A);
    });
  });
});

describe("every tenant table", () => {
  it("carries RLS and FORCE ROW LEVEL SECURITY in the catalogue", async () => {
    // Every table src/ declares is a tenant table today; a table created without the
    // hand-written FORCE line (which withRLS() cannot emit through drizzle-kit)
    // fails here rather than shipping RLS-without-FORCE silently.
    for (const qualified of declaredTableNames()) {
      const [schema, table] = qualified.split(".");
      const flags = await db.pool.query(
        "SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2",
        [schema, table],
      );
      expect({ table: qualified, ...flags.rows[0] }).toEqual({
        table: qualified,
        rls: true,
        forced: true,
      });
    }
  });

  it("carries exactly one policy — the workspace-isolation one", async () => {
    // withRLS()'s extraConfig could smuggle in a second, wider policy (policies are
    // OR-combined); one policy per tenant table is the invariant, asserted here.
    for (const qualified of declaredTableNames()) {
      const [schema, table] = qualified.split(".");
      const policies = await db.pool.query(
        "SELECT policyname FROM pg_policies WHERE schemaname = $1 AND tablename = $2",
        [schema, table],
      );
      expect({ table: qualified, policies: policies.rows }).toEqual({
        table: qualified,
        policies: [{ policyname: `${table}_workspace_isolation` }],
      });
    }
  });
});

describe("a tenant table under app_rt", () => {
  it("returns zero rows on a missing scope, never another tenant's", async () => {
    await withRollback(db.pool, async (client) => {
      await seedTwoWorkspaces(client);
      await client.query("SET LOCAL ROLE app_rt");

      const unscoped = await client.query("SELECT id FROM workspace");
      expect(unscoped.rows).toEqual([]);
    });
  });

  it("returns exactly the scoped tenant's rows", async () => {
    await withRollback(db.pool, async (client) => {
      await seedTwoWorkspaces(client);
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      const scoped = await client.query("SELECT id FROM workspace");
      expect(scoped.rows).toEqual([{ id: WS_A }]);
    });
  });

  it("returns zero llm_route rows on a missing or empty scope", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      await seed.llmRoute({ workspaceId: WS_A });
      await client.query("SET LOCAL ROLE app_rt");

      const unscoped = await client.query("SELECT id FROM llm_route");
      expect(unscoped.rows).toEqual([]);

      await client.query("SELECT set_config('app.workspace_id', '', true)");
      const emptyScope = await client.query("SELECT id FROM llm_route");
      expect(emptyScope.rows).toEqual([]);
    });
  });

  it("refuses a write into another tenant's scope", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      await expect(seed.llmRoute({ workspaceId: WS_B })).rejects.toThrow(/row-level security/);
    });
  });
});

describe("the workspace-lifecycle function", () => {
  it("creates the chunk partition and its HNSW index for app_rt, in one transaction", async () => {
    await withRollback(db.pool, async (client) => {
      await seedTwoWorkspaces(client);
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      await client.query("SELECT create_workspace_partition($1)", [WS_A]);

      const partition = await client.query(
        "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'index' AND c.relname = $1",
        [`chunk_${WS_A}`],
      );
      expect(partition.rowCount).toBe(1);

      const index = await client.query(
        "SELECT indexdef FROM pg_indexes WHERE schemaname = 'index' AND tablename = $1",
        [`chunk_${WS_A}`],
      );
      expect(index.rows.map((row) => row.indexdef).join(" ")).toContain("hnsw");
    });

    // "In one transaction" made checkable: the enclosing transaction rolled back, so
    // the partition and its index went with it.
    const afterRollback = await db.pool.query(
      "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'index' AND c.relname = $1",
      [`chunk_${WS_A}`],
    );
    expect(afterRollback.rowCount).toBe(0);
  });

  it("is refused to any role but app_rt", async () => {
    await withRollback(db.pool, async (client) => {
      await client.query("SET LOCAL ROLE worker_rt");
      await expect(client.query("SELECT create_workspace_partition($1)", [WS_A])).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  it("refuses a workspace the transaction is not scoped to, and an unknown one", async () => {
    await withRollback(db.pool, async (client) => {
      await seedTwoWorkspaces(client);
      await client.query("SET LOCAL ROLE app_rt");

      // No scope at all.
      await expect(client.query("SELECT create_workspace_partition($1)", [WS_A])).rejects.toThrow(
        /not scoped/,
      );
    });
    await withRollback(db.pool, async (client) => {
      await seedTwoWorkspaces(client);
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      // Scoped to A, asking for B's objects.
      await expect(client.query("SELECT create_workspace_partition($1)", [WS_B])).rejects.toThrow(
        /not scoped/,
      );
    });
    await withRollback(db.pool, async (client) => {
      const unknown = "01J6CCCCCCCCCCCCCCCCCCCCCC";
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [unknown]);

      await expect(
        client.query("SELECT create_workspace_partition($1)", [unknown]),
      ).rejects.toThrow(/no such workspace/);
    });
  });

  it("scopes chunk rows to their tenant through the parent, and denies the child table outright", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      await client.query("SELECT create_workspace_partition($1)", [WS_A]);
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_B]);
      await client.query("SELECT create_workspace_partition($1)", [WS_B]);

      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      await seed.chunk({ workspaceId: WS_A, content: "hello" });

      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_B]);
      const otherTenant = await client.query('SELECT id FROM "index".chunk');
      expect(otherTenant.rows).toEqual([]);

      await client.query("SELECT set_config('app.workspace_id', '', true)");
      const missingScope = await client.query('SELECT id FROM "index".chunk');
      expect(missingScope.rows).toEqual([]);
    });
  });

  it("denies a direct query against a partition, whatever the scope", async () => {
    // The RLS-bypass Cubic caught: parent policies do not apply to a query aimed at
    // a child table, and migration 0000's default privileges would have granted the
    // runtime roles DML on it — the lifecycle function revokes them, so the only
    // road to chunk rows is the policied parent.
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      await client.query("SELECT create_workspace_partition($1)", [WS_A]);
      await seed.chunk({ workspaceId: WS_A, content: "hello" });

      // The other tenant's scope, aiming straight at A's partition. Each denial
      // aborts the transaction, so a savepoint fences it from the next assertion.
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_B]);
      await client.query("SAVEPOINT direct_query");
      await expect(client.query(`SELECT id FROM "index"."chunk_${WS_A}"`)).rejects.toThrow(
        /permission denied/,
      );
      await client.query("ROLLBACK TO SAVEPOINT direct_query");

      // Even the owning tenant goes through the parent, never the child.
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      await expect(client.query(`SELECT id FROM "index"."chunk_${WS_A}"`)).rejects.toThrow(
        /permission denied/,
      );
    });
  });
});
