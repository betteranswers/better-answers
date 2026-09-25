import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import pg from "pg";
import { describe, expect, inject, it } from "vitest";

import { testData } from "./factory.ts";
import type { MigratedPostgres } from "./harness.ts";
import { openMigratedPostgres } from "./warm-postgres.ts";

const run = promisify(execFile);
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const warmPostgresModule = fileURLToPath(new URL("./warm-postgres.ts", import.meta.url));

const writeRoute = async (db: MigratedPostgres): Promise<void> => {
  const client = await db.pool.connect();
  try {
    await testData(client).llmRoute();
  } finally {
    client.release();
  }
};

const routesIn = async (db: MigratedPostgres): Promise<number> => {
  const counted = await db.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM "llm_route"');
  return counted.rows[0]?.n ?? -1;
};

const databaseNameOf = async (db: MigratedPostgres): Promise<string> => {
  const named = await db.pool.query<{ name: string }>("SELECT current_database() AS name");
  return named.rows[0]?.name ?? "";
};

const isLeftBehind = async (db: MigratedPostgres, name: string): Promise<boolean> => {
  const found = await db.pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
  return (found.rowCount ?? 0) > 0;
};

const codeOf = (error: Error): string =>
  "code" in error && typeof error.code === "string" ? error.code : error.message;

type Durability = {
  readonly fsync: string;
  readonly synchronous_commit: string;
  readonly full_page_writes: string;
};

const durabilityOf = async (db: MigratedPostgres): Promise<Durability> => {
  const [fsync, synchronousCommit, fullPageWrites] = await Promise.all([
    db.pool.query<{ fsync: string }>("SHOW fsync"),
    db.pool.query<{ synchronous_commit: string }>("SHOW synchronous_commit"),
    db.pool.query<{ full_page_writes: string }>("SHOW full_page_writes"),
  ]);
  return {
    fsync: fsync.rows[0]?.fsync ?? "",
    synchronous_commit: synchronousCommit.rows[0]?.synchronous_commit ?? "",
    full_page_writes: fullPageWrites.rows[0]?.full_page_writes ?? "",
  };
};

const DURABILITY_OFF: Durability = {
  fsync: "off",
  synchronous_commit: "off",
  full_page_writes: "off",
};

describe("the warm harness", () => {
  it("hands back a cluster with its three durability costs off", async () => {
    const db = await openMigratedPostgres("durability");
    try {
      expect(await durabilityOf(db)).toEqual(DURABILITY_OFF);
    } finally {
      await db.stop();
    }
  });

  it("gives each file a database of its own", async () => {
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

  it("hands the copy back as app_rt, the unscoped read refused", async () => {
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

  it("carries the policies and runtime grants onto the copy", async () => {
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

  it("drops a file's database on stop, leaving the cluster up", async () => {
    const stopped = await openMigratedPostgres("stopped");
    const name = await databaseNameOf(stopped);
    await stopped.stop();

    const next = await openMigratedPostgres("after-the-stop");
    try {
      expect({ leftBehind: await isLeftBehind(next, name), served: await routesIn(next) }).toEqual({
        leftBehind: false,
        served: 0,
      });
    } finally {
      await next.stop();
    }
  });

  it("drops a file's database despite a stray session on it", async () => {
    const warm = inject("warmPostgres");
    if (warm === undefined) throw new Error("this run provided no warm cluster");
    const held = await openMigratedPostgres("held-open");
    const name = await databaseNameOf(held);
    const strayUri = new URL(warm.connectionUri);
    strayUri.pathname = `/${name}`;
    const stray = new pg.Client({ connectionString: strayUri.toString() });
    await stray.connect();
    const terminated = new Promise<string>((resolve) => {
      stray.on("error", (error) => resolve(codeOf(error)));
    });

    await held.stop();

    const next = await openMigratedPostgres("after-held-open");
    try {
      expect({ leftBehind: await isLeftBehind(next, name), stray: await terminated }).toEqual({
        leftBehind: false,
        stray: "57P01",
      });
    } finally {
      await Promise.all([next.stop(), stray.end()]);
    }
  });

  it("re-opens a key onto a fresh database", async () => {
    const bailed = await openMigratedPostgres("re-run");
    await writeRoute(bailed);
    const name = await databaseNameOf(bailed);

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

  it("starts a database of its own without a warm cluster", async () => {
    const script = [
      `import { openMigratedPostgres } from ${JSON.stringify(warmPostgresModule)};`,
      "const db = await openMigratedPostgres();",
      "const footing = await db.runtimePool.query('SELECT current_user AS role');",
      "const policies = await db.pool.query('SELECT policyname FROM pg_policies WHERE tablename = $1', ['llm_route']);",
      "const fsync = await db.pool.query('SHOW fsync');",
      "const synchronousCommit = await db.pool.query('SHOW synchronous_commit');",
      "const fullPageWrites = await db.pool.query('SHOW full_page_writes');",
      "const answer = { role: footing.rows[0].role, isolationPolicy: policies.rows[0].policyname, durability: { fsync: fsync.rows[0].fsync, synchronous_commit: synchronousCommit.rows[0].synchronous_commit, full_page_writes: fullPageWrites.rows[0].full_page_writes } };",
      "process.stdout.write(JSON.stringify(answer));",
      "await db.stop();",
    ].join("\n");

    const cold = await run(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: packageRoot,
    });

    expect(JSON.parse(cold.stdout)).toEqual({
      role: "app_rt",
      isolationPolicy: "llm_route_workspace_isolation",
      durability: DURABILITY_OFF,
    });
  }, 300_000);
});
