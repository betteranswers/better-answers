import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { testData } from "./factory.ts";
import type { MigratedPostgres } from "./harness.ts";
import { openMigratedPostgres } from "./warm-postgres.ts";

/**
 * The warm harness through its own interface (`[DESIGN2]`, `[TEST1]`): what a caller of
 * `openMigratedPostgres` receives, and nothing about how it was got. No test here counts
 * containers or reads the opener's internals — one that did would pin the mechanism
 * instead of the guarantee, and the mechanism is what the rest of `T-085` moves.
 *
 * The guarantees are the ones a suite depends on today: a database of its own, fully
 * migrated and empty; the runtime pool on `app_rt` with the tenant tables still refusing an
 * unscoped read; the policies and grants that refusal rests on; and, where nothing provided
 * a warm cluster, a container of its own exactly as before.
 */

const run = promisify(execFile);
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const warmPostgresModule = fileURLToPath(new URL("./warm-postgres.ts", import.meta.url));

/**
 * A committed llm route through the factory (`[TEST4]`), in a workspace of its own. A
 * tenant table, so the same row answers both the independence question and the zero-rows
 * one; and committed, because what the independence proof needs is a row that outlives the
 * connection that wrote it — which `withRollback`, the data suites' usual footing, by
 * design never leaves behind.
 */
const writeRoute = async (db: MigratedPostgres): Promise<void> => {
  const client = await db.pool.connect();
  try {
    await testData(client).llmRoute();
  } finally {
    client.release();
  }
};

/** What the superuser can see in this database — RLS does not apply to it. */
const routesIn = async (db: MigratedPostgres): Promise<number> => {
  const counted = await db.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM "llm_route"');
  return counted.rows[0]?.n ?? -1;
};

const databaseNameOf = async (db: MigratedPostgres): Promise<string> => {
  const named = await db.pool.query<{ name: string }>("SELECT current_database() AS name");
  return named.rows[0]?.name ?? "";
};

describe("the warm harness", () => {
  it("gives each file a database of its own — a route written through one is not there through the other", async () => {
    const one = await openMigratedPostgres("one-file");
    const another = await openMigratedPostgres("another-file");
    try {
      await writeRoute(one);

      expect({ one: await routesIn(one), another: await routesIn(another) }).toEqual({
        one: 1,
        another: 0,
      });
    } finally {
      await Promise.all([one.stop(), another.stop()]);
    }
  });

  it("hands the copy back on the app's own footing, with the unscoped read still refused", async () => {
    // No key: the database is named after this test file, which is how every suite will
    // call it. One statement asks both questions the runtime pool exists to answer — who
    // the session is, and what a tenant table gives it with no workspace scope set.
    const db = await openMigratedPostgres();
    try {
      await writeRoute(db);

      const asRuntime = await db.runtimePool.query<{ role: string; routes: number }>(
        'SELECT current_user AS role, (SELECT count(*)::int FROM "llm_route") AS routes',
      );
      expect({ ...asRuntime.rows[0], asSuperuser: await routesIn(db) }).toEqual({
        role: "app_rt",
        routes: 0,
        asSuperuser: 1,
      });
    } finally {
      await db.stop();
    }
  });

  it("carries the policies and the runtime role's grants onto the copy", async () => {
    // That each tenant table is policied and forced is `rls.test.ts`'s subject and stays
    // there; what is asked here is only whether `CREATE DATABASE … TEMPLATE` brings the
    // per-database objects across — a policy, the schema grant, a table grant and the
    // default privileges a later table would inherit.
    const db = await openMigratedPostgres("grants");
    try {
      const catalogue = await db.pool.query(
        `SELECT (SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'llm_route') AS "isolationPolicy",
                EXISTS (SELECT 1 FROM pg_default_acl) AS "defaultPrivileges",
                has_schema_privilege('app_rt', 'public', 'USAGE') AS "schemaUsage",
                has_table_privilege('app_rt', 'public.llm_route', 'SELECT') AS "tableSelect"`,
      );
      expect(catalogue.rows[0]).toEqual({
        isolationPolicy: "llm_route_workspace_isolation",
        defaultPrivileges: true,
        schemaUsage: true,
        tableSelect: true,
      });
    } finally {
      await db.stop();
    }
  });

  it("drops a file's database when it stops, and leaves the cluster up for the files after it", async () => {
    const stopped = await openMigratedPostgres("stopped");
    const name = await databaseNameOf(stopped);
    await stopped.stop();

    const next = await openMigratedPostgres("after-the-stop");
    try {
      const leftBehind = await next.pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [
        name,
      ]);
      expect({ leftBehind: leftBehind.rowCount, served: await routesIn(next) }).toEqual({
        leftBehind: 0,
        served: 0,
      });
    } finally {
      await next.stop();
    }
  });

  it("re-opens a key onto a fresh database, so a run that bailed cannot leave one behind", async () => {
    const bailed = await openMigratedPostgres("re-run");
    await writeRoute(bailed);
    const name = await databaseNameOf(bailed);
    // What a bail leaves: the database still there, because `afterAll` never ran to drop
    // it. Closing only the pools is what Vitest resetting the module registry between
    // mutant runs amounts to — the rows survive, nothing is holding them.
    await bailed.pool.end();
    await bailed.runtimePool.end();

    const reopened = await openMigratedPostgres("re-run");
    try {
      expect({
        database: await databaseNameOf(reopened),
        routes: await routesIn(reopened),
      }).toEqual({ database: name, routes: 0 });
    } finally {
      await reopened.stop();
    }
  });

  it("starts a database of its own where nothing provided a warm cluster", async () => {
    // A plain Node process: no Vitest, so nothing to inject and no container but the one
    // this call starts. Driven from outside because that absence is the whole condition,
    // and it cannot be arranged inside a run that has a warm cluster to offer.
    const script = [
      `import { openMigratedPostgres } from ${JSON.stringify(warmPostgresModule)};`,
      "const db = await openMigratedPostgres();",
      "const footing = await db.runtimePool.query('SELECT current_user AS role');",
      "const policies = await db.pool.query('SELECT policyname FROM pg_policies WHERE tablename = $1', ['llm_route']);",
      "const answer = { role: footing.rows[0].role, isolationPolicy: policies.rows[0].policyname };",
      "process.stdout.write(JSON.stringify(answer));",
      "await db.stop();",
    ].join("\n");

    const cold = await run(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: packageRoot,
    });

    expect(JSON.parse(cold.stdout)).toEqual({
      role: "app_rt",
      isolationPolicy: "llm_route_workspace_isolation",
    });
  }, 300_000);
});
