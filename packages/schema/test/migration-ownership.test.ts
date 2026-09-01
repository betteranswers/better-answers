import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { journalEntries, journalMigrationFiles } from "../src/journal.ts";

/**
 * The one-journal rule's CI check (ADR 0032): Drizzle *generates* migrations for
 * `public` and *carries* hand-written ones for everything else, so a generated
 * migration must never touch the `index` schema or the graph tables. A hand-written
 * migration declares itself with the first-line marker; anything without it is
 * treated as generated and held to the rule.
 */

const CUSTOM_MARKER = "-- Custom migration (hand-written SQL; ADR 0032).";
// Any mention of the quoted schema at all — `"index".chunk` and `CREATE SCHEMA
// "index"` alike — and the graph tables by name.
const FORBIDDEN_IN_GENERATED = [/"index"/u, /\bgraph_node\b/u, /\bgraph_edge\b/u];

describe("the migration journal", () => {
  it("has a file for every entry, and no .sql file the journal does not know", () => {
    const journalFiles = journalMigrationFiles().map((file) => path.basename(file));
    const migrationsDir = path.dirname(journalMigrationFiles()[0] ?? "");
    const onDisk = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql"));

    // Both directions: a journal entry with no file will never apply; an orphan
    // .sql file on disk will never apply either, and someone thinks it did.
    expect(journalFiles.toSorted()).toEqual(onDisk.toSorted());
  });

  it("never touches `index` or the graph tables from a generated migration", () => {
    for (const [position, file] of journalMigrationFiles().entries()) {
      const sql = readFileSync(file, "utf8");
      if (sql.startsWith(CUSTOM_MARKER)) continue;
      const tag = journalEntries()[position]?.tag ?? path.basename(file);
      for (const forbidden of FORBIDDEN_IN_GENERATED) {
        expect
          .soft(sql, `${tag}.sql is generated and must not match ${String(forbidden)}`)
          .not.toMatch(forbidden);
      }
    }
  });
});
