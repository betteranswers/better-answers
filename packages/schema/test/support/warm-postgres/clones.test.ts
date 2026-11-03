import pg from "pg";
import { describe, expect, it } from "vitest";

import { testData } from "../factory.ts";
import { endPool, type MigratedPostgres } from "../harness.ts";
import { matching } from "../matching.ts";
import { clonedFrom, openMigratedPostgres } from "../warm-postgres.ts";
import { codeOf, DURABILITY_OFF, durabilityOf, onDatabase, warmOfThisRun } from "./server.ts";

const writeModelChoice = async (db: MigratedPostgres): Promise<void> => {
  const client = await db.pool.connect();
  try {
    await testData(client).modelChoice();
  } finally {
    client.release();
  }
};

const modelChoicesIn = async (db: MigratedPostgres): Promise<number> => {
  const counted = await db.pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM "model_choice"',
  );
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

describe("the warm harness", () => {
  it("hands back a cluster with its three durability costs off", async () => {
    const db = await openMigratedPostgres("durability");
    try {
      expect(await durabilityOf(db)).toEqual(DURABILITY_OFF);
    } finally {
      await db.stop();
    }
  });

  it("holds the question months of the server's clock", async () => {
    const db = await openMigratedPostgres("question-months");
    try {
      const made = await db.pool.query<{ name: string }>(
        `SELECT child.relname AS name FROM pg_inherits
           JOIN pg_class child ON child.oid = pg_inherits.inhrelid
          WHERE pg_inherits.inhparent = 'question_content'::regclass ORDER BY 1`,
      );
      const clock = await db.pool.query<{ name: string }>(
        `SELECT 'question_content_' || to_char((now() AT TIME ZONE 'UTC') + months * interval '1 month', 'YYYY_MM') AS name
           FROM unnest(ARRAY[0, 1]) AS months`,
      );

      expect(made.rows).toEqual(clock.rows);
    } finally {
      await db.stop();
    }
  });

  it("gives each file a database of its own", async () => {
    const one = await openMigratedPostgres("one-file");
    const another = await openMigratedPostgres("another-file");
    try {
      await writeModelChoice(one);

      expect({ one: await modelChoicesIn(one), another: await modelChoicesIn(another) }).toEqual({
        one: 1,
        another: 0,
      });
    } finally {
      await Promise.all([one.stop(), another.stop()]);
    }
  });

  it("names each key's clone after the key and the run", async () => {
    const warm = warmOfThisRun();
    const one = await clonedFrom(warm, "one-key-named");
    const another = await clonedFrom(warm, "another-key-named");
    try {
      expect({ one: await databaseNameOf(one), another: await databaseNameOf(another) }).toEqual({
        one: matching.stringMatching(
          new RegExp(`^ba_one_key_named_[0-9a-f]{12}_${String(warm.runId)}$`, "u"),
        ),
        another: matching.stringMatching(
          new RegExp(`^ba_another_key_named_[0-9a-f]{12}_${String(warm.runId)}$`, "u"),
        ),
      });
    } finally {
      await Promise.all([one.stop(), another.stop()]);
    }
  });

  it("hands the copy back as app_rt, the unscoped read refused", async () => {
    const db = await openMigratedPostgres();
    try {
      await writeModelChoice(db);

      const asRuntime = await db.runtimePool.query<{ role: string; modelChoices: number }>(
        'SELECT current_user AS role, (SELECT count(*)::int FROM "model_choice") AS "modelChoices"',
      );
      expect({ ...asRuntime.rows[0], asSuperuser: await modelChoicesIn(db) }).toEqual({
        role: "app_rt",
        modelChoices: 0,
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
        `SELECT (SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'model_choice') AS "isolationPolicy",
                EXISTS (SELECT 1 FROM pg_default_acl) AS "defaultPrivileges",
                has_schema_privilege('app_rt', 'public', 'USAGE') AS "schemaUsage",
                has_table_privilege('app_rt', 'public.model_choice', 'SELECT') AS "tableSelect"`,
      );
      expect(catalogue.rows[0]).toEqual({
        isolationPolicy: "model_choice_workspace_isolation",
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
      expect({
        leftBehind: await isLeftBehind(next, name),
        served: await modelChoicesIn(next),
      }).toEqual({
        leftBehind: false,
        served: 0,
      });
    } finally {
      await next.stop();
    }
  });

  it("drops a file's database despite a stray session on it", async () => {
    const held = await openMigratedPostgres("held-open");
    const name = await databaseNameOf(held);
    const stray = new pg.Client({
      connectionString: onDatabase(warmOfThisRun().connectionUri, name),
    });
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
    await writeModelChoice(bailed);
    const name = await databaseNameOf(bailed);

    await endPool(bailed.pool);
    await endPool(bailed.runtimePool);

    const reopened = await openMigratedPostgres("re-run");
    try {
      expect({
        database: await databaseNameOf(reopened),
        modelChoices: await modelChoicesIn(reopened),
      }).toEqual({ database: name, modelChoices: 0 });
    } finally {
      await reopened.stop();
    }
  });
});

describe("the warm harness under TEST_POSTGRES_URI", () => {
  it("gives two runs' opens of one key separate databases", async () => {
    const warm = warmOfThisRun();
    const ours = await clonedFrom(warm, "one-key");
    const theirs = await clonedFrom({ ...warm, runId: process.pid }, "one-key");
    try {
      const theirName = await databaseNameOf(theirs);
      await writeModelChoice(ours);
      await theirs.stop();

      expect({
        separate: theirName !== (await databaseNameOf(ours)),
        theirsLeft: await isLeftBehind(ours, theirName),
        ours: await modelChoicesIn(ours),
      }).toEqual({ separate: true, theirsLeft: false, ours: 1 });
    } finally {
      await ours.stop();
    }
  });
});
