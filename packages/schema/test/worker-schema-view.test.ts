import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  assertNoUndeclaredTables,
  introspect,
  renderWorkerSchemaView,
} from "../scripts/worker-view.ts";
import { type MigratedPostgres, startMigratedPostgres } from "./harness.ts";

/**
 * The drift check, both directions (ADR 0032): regenerate the worker's schema view
 * from the journal and fail on a stale committed view, and on any table in the
 * migrated database the `src/` declarations do not know.
 */

const viewPath = path.resolve(
  import.meta.dirname,
  "../../../apps/worker/src/better_answers_worker/schema_view.py",
);
const journalPath = path.resolve(import.meta.dirname, "../migrations/meta/_journal.json");

type Journal = { readonly entries: readonly { readonly tag: string }[] };

let db: MigratedPostgres;

beforeAll(async () => {
  db = await startMigratedPostgres();
}, 120_000);

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
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal;
    const migrationId = journal.entries.at(-1)?.tag;
    if (migrationId === undefined) throw new Error("the journal is empty");

    const regenerated = renderWorkerSchemaView(await introspect(db.pool), migrationId);
    expect(readFileSync(viewPath, "utf8")).toBe(regenerated);
    expect(regenerated).toContain(`MIGRATION_ID = "${migrationId}"`);
  });
});
