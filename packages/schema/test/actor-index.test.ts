import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type MigratedPostgres, withRollback } from "./harness.ts";
import { migrationStatements } from "./journal-statements.ts";
import { openMigratedPostgres } from "./warm-postgres.ts";

const THE_MIGRATION = "the-actor-index.sql";

const THE_INDEX = "audit_event_actor_idx";

let db: MigratedPostgres;

beforeAll(async () => {
  db = await openMigratedPostgres();
});

afterAll(async () => {
  await db.stop();
});

const migrated = async (client: pg.PoolClient): Promise<void> => {
  for (const statement of migrationStatements(THE_MIGRATION)) {
    await client.query(statement);
  }
};

const indexesNamed = async (client: pg.PoolClient): Promise<readonly string[]> =>
  (
    await client.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE indexname = $1",
      [THE_INDEX],
    )
  ).rows.map((row) => row.indexdef);

/** The shape a database held before the migration, inside the caller's transaction. */
const migratedFromBefore = async <T>(client: pg.PoolClient, read: () => Promise<T>): Promise<T> => {
  await client.query(`DROP INDEX "${THE_INDEX}"`);
  await migrated(client);
  return read();
};

/** Puts the index back for the cases after, as `migrate` would have left it. */
const migratedAndCommitted = async (): Promise<void> => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await migrated(client);
    await client.query("COMMIT");
  } finally {
    client.release();
  }
};

/** An act's transaction that has written to the audit log and not yet committed. */
const whileAnAuditWriteIsOpen = async <T>(work: () => Promise<T>): Promise<T> => {
  const writer = await db.pool.connect();
  try {
    await writer.query("BEGIN");
    await writer.query("LOCK TABLE audit_event IN ROW EXCLUSIVE MODE");
    return await work();
  } finally {
    await writer.query("ROLLBACK");
    writer.release();
  }
};

describe("the migration that indexes the audit log by actor", () => {
  it("builds the index on workspace, actor, time and id", async () => {
    const built = await withRollback(db.pool, (client) =>
      migratedFromBefore(client, () => indexesNamed(client)),
    );

    expect(built).toEqual([
      "CREATE INDEX audit_event_actor_idx ON public.audit_event USING btree (workspace_id, actor, at, id)",
    ]);
  });

  it("leaves no lock bound on the migrations after it", async () => {
    const after = await withRollback(db.pool, (client) =>
      migratedFromBefore(client, async () => {
        const shown = await client.query<{ lock_timeout: string }>("SHOW lock_timeout");
        return shown.rows[0]?.lock_timeout;
      }),
    );

    expect(after).toBe("0");
  });

  it("fails rather than waits behind an open audit write", async () => {
    await db.pool.query(`DROP INDEX "${THE_INDEX}"`);
    try {
      const blocked = whileAnAuditWriteIsOpen(() =>
        withRollback(db.pool, async (client) => {
          await migrated(client);
        }),
      );

      await expect(blocked).rejects.toThrow(/canceling statement due to lock timeout/);
      expect(await withRollback(db.pool, indexesNamed)).toEqual([]);
    } finally {
      await migratedAndCommitted();
    }
  });
});
