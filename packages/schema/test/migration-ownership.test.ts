import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CONCEPT_FRONTMATTER_MAX,
  SUGGESTION_KINDS_FROM_A_RUN,
  SUGGESTION_KINDS_FROM_THE_APP,
  SUGGESTION_SET_MAX,
} from "../src/index.ts";
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
// "index"` alike — and the graph tables by name, the live-generation row's included.
const FORBIDDEN_IN_GENERATED = [
  /"index"/u,
  /\bgraph_node\b/u,
  /\bgraph_edge\b/u,
  /\bgraph_generation\b/u,
];

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

/**
 * **The facts a hand-written migration copies.** SQL cannot import a constant, so the inbox
 * substrate states three of them in its own text — the kinds each tier may raise, how large
 * a set may be, how large a frontmatter may be — and names the constant it copied in a
 * comment beside each. A copy nobody reads back is a second source of truth: the day a
 * constant moves, the two disagree and only the database is listened to. So the pair is
 * checked here, which is also what gives each constant a consumer (`[TEST7]`).
 */
const inboxSubstrate = (): string => {
  const file = journalMigrationFiles().find((name) => name.endsWith("the-inbox-substrate.sql"));
  if (file === undefined) throw new Error("the inbox substrate is not in the journal");
  return readFileSync(file, "utf8");
};

/** The words of an `ARRAY['a', 'b']` list, in the order the SQL wrote them. */
const kindsAdmittedFor = (sql: string, role: string): readonly string[] => {
  const found = new RegExp(`WHEN '${role}' THEN ARRAY\\[([^\\]]*)\\]`, "u").exec(sql);
  if (found === null) throw new Error(`the submit function admits no kinds for ${role}`);
  return [...(found[1] ?? "").matchAll(/'([^']*)'/gu)].map(([, word]) => word ?? "");
};

describe("what the inbox substrate copies from the schema package", () => {
  it("admits exactly the kinds each tier's own constant names", () => {
    const sql = inboxSubstrate();

    // Both lists in one assertion, so a change that moved one and forgot the other reads
    // as the disagreement it is rather than as two failures to line up by hand.
    expect({
      app: kindsAdmittedFor(sql, "app_rt"),
      run: kindsAdmittedFor(sql, "worker_rt"),
    }).toEqual({
      app: [...SUGGESTION_KINDS_FROM_THE_APP],
      run: [...SUGGESTION_KINDS_FROM_A_RUN],
    });
  });

  it("bounds a set and a frontmatter at the numbers their constants hold", () => {
    const sql = inboxSubstrate();

    // The guard and the sentence it raises each carry the number, and a reader who fixed
    // only one would leave the refusal saying something the function does not do.
    expect(sql).toContain(`BETWEEN 1 AND ${SUGGESTION_SET_MAX}`);
    expect(sql).toContain(`between one and ${SUGGESTION_SET_MAX} requests`);
    expect(sql).toContain(`> ${CONCEPT_FRONTMATTER_MAX}`);
    expect(sql).toContain(`of at most ${CONCEPT_FRONTMATTER_MAX} characters`);
  });
});
