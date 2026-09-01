import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The one-journal rule's CI check (ADR 0032): Drizzle *generates* migrations for
 * `public` and *carries* hand-written ones for everything else, so a generated
 * migration must never touch the `index` schema or the graph tables. A hand-written
 * migration declares itself with the first-line marker; anything without it is
 * treated as generated and held to the rule.
 */

const CUSTOM_MARKER = "-- Custom migration (hand-written SQL; ADR 0032).";
const FORBIDDEN_IN_GENERATED = [/"index"\./u, /\bgraph_node\b/u, /\bgraph_edge\b/u];

const migrationsDir = path.resolve(import.meta.dirname, "../migrations");
const journalPath = path.join(migrationsDir, "meta", "_journal.json");

type Journal = { readonly entries: readonly { readonly tag: string }[] };
const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal;

describe("the migration journal", () => {
  it("has a file for every entry", () => {
    for (const entry of journal.entries) {
      expect(() => readFileSync(path.join(migrationsDir, `${entry.tag}.sql`))).not.toThrow();
    }
  });

  it("never touches `index` or the graph tables from a generated migration", () => {
    for (const entry of journal.entries) {
      const sql = readFileSync(path.join(migrationsDir, `${entry.tag}.sql`), "utf8");
      if (sql.startsWith(CUSTOM_MARKER)) continue;
      for (const forbidden of FORBIDDEN_IN_GENERATED) {
        expect
          .soft(sql, `${entry.tag}.sql is generated and must not match ${String(forbidden)}`)
          .not.toMatch(forbidden);
      }
    }
  });
});
