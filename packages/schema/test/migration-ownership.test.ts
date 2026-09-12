import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  AUDIENCE_CHECK,
  CONCEPT_FRONTMATTER_MAX,
  SUGGESTION_KINDS_FROM_A_RUN,
  SUGGESTION_KINDS_FROM_THE_APP,
  SUGGESTION_SET_MAX,
} from "../src/index.ts";
import {
  journalEntries,
  journalMigrationFiles,
  journalSnapshots,
  journalSnapshotsIn,
} from "../src/journal.ts";

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
 * **The other half of `meta/`.** The journal names a `.sql` file per entry, held above, and
 * drizzle-kit writes a second file per entry beside it — `meta/<idx>_snapshot.json`, the
 * schema as it stood after that migration, each one pointing back at the one before through
 * `prevId`. That chain is what the next `generate` diffs against, so a snapshot that is not
 * there or a link that points at the wrong id makes the next generated migration wrong in a
 * way no test read until now: the journal and its directory were held against each other,
 * and `meta/` was never opened.
 *
 * The four breaks below are provoked over a **copy** of `meta/` in a throwaway directory,
 * never the tracked one. A test that deletes a tracked snapshot to watch a checker refuse it
 * has left the repository broken for every other suite in the run, and this package's suites
 * run in parallel workers against the same tree. The copy is this case's own, and the expected
 * refusal is spelled here rather than read back out of the copy, so a checker that returned
 * the folder's own state would still be caught.
 */

/** A well-formed id that is not any snapshot's, for a planted link to point at. */
const NOT_THE_ONE_BEFORE = "11111111-1111-1111-1111-111111111111";
const trees = mkdtempSync(path.join(tmpdir(), "journal-meta-"));
let copies = 0;

afterAll(() => rmSync(trees, { recursive: true, force: true }));

/** A fresh copy of the tracked `meta/`, for one case to break however it needs to. */
const aCopyOfMeta = (): string => {
  const source = path.join(path.dirname(journalMigrationFiles()[0] ?? ""), "meta");
  const destination = path.join(trees, `meta-${String(++copies)}`);
  cpSync(source, destination, { recursive: true });
  return destination;
};

/**
 * A copy whose named snapshot has been made to point at an id no snapshot has. Only `prevId`
 * moves: the schema the file carries is left as it was, so what the checker refuses is the
 * link and not a file it could not read.
 */
const aCopyWithAPlantedLink = (snapshotName: string): string => {
  const meta = aCopyOfMeta();
  const snapshot = path.join(meta, snapshotName);
  const planted = JSON.parse(readFileSync(snapshot, "utf8")) as Record<string, unknown>;
  writeFileSync(snapshot, JSON.stringify({ ...planted, prevId: NOT_THE_ONE_BEFORE }));
  return meta;
};

describe("the journal's meta folder", () => {
  it("has a snapshot for every entry, an entry for every snapshot, and one chain through them", () => {
    const read = journalSnapshots();

    // The refusal is the failure message. An assertion on `ok` alone would read `false`,
    // where the folder's own answer names the file somebody has to open.
    expect(read.ok || read.error).toBe(true);
    expect(read.ok && read.value.at(0)).toBe("0000_snapshot.json");
  });

  it("refuses a journal entry whose snapshot is not in the folder", () => {
    const meta = aCopyOfMeta();
    rmSync(path.join(meta, "0001_snapshot.json"));

    expect(journalSnapshotsIn(meta)).toEqual({
      ok: false,
      // The tag is the journal's own word for the migration, which is what a reader needs to
      // find the entry; no migration can renumber this one.
      error: { kind: "snapshot-missing", tag: "0001_first-tables", snapshot: "0001_snapshot.json" },
    });
  });

  it("refuses a snapshot the journal does not name", () => {
    // The other direction. One direction finds the snapshot a migration never got; only this
    // one finds the snapshot left behind by a migration that was renamed or dropped, which
    // the next `generate` may well diff against.
    const meta = aCopyOfMeta();
    writeFileSync(path.join(meta, "9999_snapshot.json"), "{}");

    expect(journalSnapshotsIn(meta)).toEqual({
      ok: false,
      error: { kind: "snapshot-orphaned", snapshot: "9999_snapshot.json" },
    });
  });

  it("refuses a snapshot whose prevId is not the id of the snapshot before it", () => {
    // Membership alone would pass a folder whose snapshots are all present and in the wrong
    // order, or one carrying a snapshot taken from another branch: the chain is what says
    // these files are one history rather than a set of files with matching names.
    expect(journalSnapshotsIn(aCopyWithAPlantedLink("0001_snapshot.json"))).toEqual({
      ok: false,
      error: { kind: "chain-broken", earlier: "0000_snapshot.json", later: "0001_snapshot.json" },
    });
  });

  it("refuses a first snapshot that points at something rather than at nothing", () => {
    // The chain's root. Every link after this one is checked against the snapshot before it,
    // so nothing but this holds the head: a first snapshot pointing at an id would make the
    // whole folder the tail of a history this repository does not have.
    expect(journalSnapshotsIn(aCopyWithAPlantedLink("0000_snapshot.json"))).toEqual({
      ok: false,
      error: { kind: "chain-unrooted", snapshot: "0000_snapshot.json" },
    });
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

/**
 * The audience substrate copies one more fact (ADR 0039): the CHECK tying the audience word
 * to its group-id array is written once in `concept-tables.ts` and read by every generated
 * table's declaration, but the chunk and graph tables are hand-written DDL, so the migration
 * that adds the pair to them states the CHECK in its own text. Read back here, once per
 * table, so the three copies can never drift from the one the generated tables carry.
 */
describe("what the audience substrate copies from the schema package", () => {
  it("ties the word to the array on the chunk and graph tables with the one CHECK the declarations carry", () => {
    const file = journalMigrationFiles().find((name) => name.endsWith("audience-substrate.sql"));
    if (file === undefined) throw new Error("the audience substrate is not in the journal");
    const sql = readFileSync(file, "utf8");

    for (const table of ["chunk", "graph_node", "graph_edge"]) {
      expect(sql).toContain(`"${table}_audience_check" CHECK (${AUDIENCE_CHECK})`);
    }
  });
});
