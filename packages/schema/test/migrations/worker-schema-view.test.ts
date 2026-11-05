import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, assert, beforeAll, describe, expect, it } from "vitest";

import {
  assertNoUndeclaredTables,
  introspect,
  renderWorkerSchemaView,
} from "../../scripts/worker-view.ts";
import { journalEntries, journalEntriesOf, lastMigration } from "../../src/journal.ts";
import type { MigratedPostgres } from "../support/harness.ts";
import { repositoryRoot } from "../support/roots/roots.ts";
import { openMigratedPostgres } from "../support/warm-postgres.ts";

const viewPath = path.resolve(
  repositoryRoot,
  "apps/worker/src/better_answers_worker/schema_view.py",
);
let db: MigratedPostgres;

beforeAll(async () => {
  db = await openMigratedPostgres();
});

afterAll(async () => {
  await db.stop();
});

const tableNames = (pythonSource: string): Set<string> =>
  new Set([...pythonSource.matchAll(/^ {4}"([^"]+)": \{$/gm)].map((match) => match[1] ?? ""));

describe("the worker's schema view", () => {
  it("names every table in the migrated database, and no other", async () => {
    const rows = await introspect(db.pool);
    assertNoUndeclaredTables(rows);

    const migrated = new Set(rows.map((row) => `${row.schema}.${row.table}`));
    const committed = tableNames(readFileSync(viewPath, "utf8"));

    const stale = [...migrated].filter((name) => !committed.has(name));
    expect(stale, "the committed view is missing these tables, so regenerate it").toEqual([]);
    const unknown = [...committed].filter((name) => !migrated.has(name));
    expect(unknown, "the committed view names tables the migrated database lacks").toEqual([]);
  });

  it("matches its regeneration and names the last migration", async () => {
    const migration = lastMigration();

    const regenerated = renderWorkerSchemaView(await introspect(db.pool), migration);
    expect(readFileSync(viewPath, "utf8")).toBe(regenerated);
    expect(regenerated).toContain(`MIGRATION_ID = "${migration.tag}"`);
  });

  it("stores the migrator's timestamp for the worker's check", async () => {
    const migration = lastMigration();
    const stamped = await db.pool.query<{ created_at: string }>(
      "SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1",
    );

    expect(readFileSync(viewPath, "utf8")).toContain(`MIGRATION_WHEN = ${migration.when}`);
    expect(Number(stamped.rows[0]?.created_at)).toBe(migration.when);
  });

  it("refuses a journal where two migrations share a timestamp", () => {
    const entries = journalEntries();
    expect(entries.map((entry) => entry.when)).toEqual(
      entries.map((entry) => entry.when).toSorted((a, b) => a - b),
    );
    expect(new Set(entries.map((entry) => entry.when)).size).toBe(entries.length);

    const last = entries.at(-1);
    assert(last !== undefined, "the journal has no entries");

    const later = { idx: 9999, tag: "9999_a-second-at-the-same-instant", when: last.when };
    expect(journalEntriesOf({ entries: [...entries, later] })).toEqual({
      ok: false,
      error: { earlier: last, later },
    });
  });
});
