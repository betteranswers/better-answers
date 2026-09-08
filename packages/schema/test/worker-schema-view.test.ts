import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  assertNoUndeclaredTables,
  introspect,
  renderWorkerSchemaView,
} from "../scripts/worker-view.ts";
import { journalEntries, journalEntriesOf, lastMigration } from "../src/journal.ts";
import type { MigratedPostgres } from "./harness.ts";
import { openMigratedPostgres } from "./warm-postgres.ts";

/**
 * The drift check, both directions (ADR 0032): regenerate the worker's schema view
 * from the journal and fail on a stale committed view, and on any table in the
 * migrated database the `src/` declarations do not know.
 */

const viewPath = path.resolve(
  import.meta.dirname,
  "../../../apps/worker/src/better_answers_worker/schema_view.py",
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
  it("knows every table the migrated database holds, and no other", async () => {
    const rows = await introspect(db.pool);
    assertNoUndeclaredTables(rows);

    const migrated = new Set(rows.map((row) => `${row.schema}.${row.table}`));
    const committed = tableNames(readFileSync(viewPath, "utf8"));

    const stale = [...migrated].filter((name) => !committed.has(name));
    expect(stale, "tables the committed view is missing — regenerate it").toEqual([]);
    const unknown = [...committed].filter((name) => !migrated.has(name));
    expect(unknown, "tables the journal does not know — the view claims too much").toEqual([]);
  });

  it("is byte-identical to a regeneration and carries the journal's last migration id", async () => {
    const migration = lastMigration();

    const regenerated = renderWorkerSchemaView(await introspect(db.pool), migration);
    expect(readFileSync(viewPath, "utf8")).toBe(regenerated);
    expect(regenerated).toContain(`MIGRATION_ID = "${migration.tag}"`);
  });

  it("stamps the instant the migrator wrote, so the worker's stamp check has something to compare", async () => {
    // The pair the worker's `[WRK1]` check joins on, held both ways: the committed view
    // carries the journal's `when` for the migration it names, and that is the value the
    // migrator actually stamped the database with. One direction finds a view regenerated
    // from a journal nobody applied; only the other finds a `when` the migrator ignores,
    // which would leave the worker comparing a number the database never writes.
    const migration = lastMigration();
    const stamped = await db.pool.query<{ created_at: string }>(
      "SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1",
    );

    expect(readFileSync(viewPath, "utf8")).toContain(`MIGRATION_WHEN = ${migration.when}`);
    expect(Number(stamped.rows[0]?.created_at)).toBe(migration.when);
  });

  it("refuses a journal whose migrations share an instant, because the stamp check could not tell them apart", () => {
    // The stamp the worker compares is `when` alone: two migrations at one instant would let
    // a database stopped after the earlier one read as stamped with the later, and the view
    // would claim against a schema one migration short. The committed journal is held to it
    // as a whole, and a journal with the defect is refused before any view is rendered.
    const entries = journalEntries();
    expect(entries.map((entry) => entry.when)).toEqual(
      entries.map((entry) => entry.when).toSorted((a, b) => a - b),
    );
    expect(new Set(entries.map((entry) => entry.when)).size).toBe(entries.length);

    const last = entries.at(-1);
    expect(() =>
      journalEntriesOf({
        entries: [...entries, { tag: "9999_a-second-at-the-same-instant", when: last?.when ?? 0 }],
      }),
    ).toThrow(/strictly increase/);
  });
});
