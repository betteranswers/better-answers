import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DrizzleSnapshotJSON } from "drizzle-kit/api";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { afterAll, describe, expect, it } from "vitest";

import { restoreFinalNewline } from "../scripts/journal-newline.ts";
import {
  AUDIENCE_CHECK,
  CONCEPT_FRONTMATTER_MAX,
  SUGGESTION_KINDS_FROM_A_RUN,
  SUGGESTION_KINDS_FROM_THE_APP,
  SUGGESTION_SET_MAX,
} from "../src/index.ts";
import {
  journalEntries,
  journalMetaFolder,
  journalMigrationFiles,
  journalSnapshots,
  journalSnapshotsIn,
} from "../src/journal.ts";
// The declarations as drizzle-kit's own `generate` reads them: the config names this module
// and nothing else, so a table it does not reach is not generated (`drizzle.config.ts`).
import * as declarations from "../src/schema.ts";

/**
 * The one-journal rule's CI check (ADR 0032): Drizzle *generates* migrations for
 * `public` and *carries* hand-written ones for everything else, so a generated
 * migration must never touch the `index` schema or the graph tables. A hand-written
 * migration declares itself with the marker as its exact first line; anything without
 * it is treated as generated and held to the rule.
 */

const CUSTOM_MARKER = "-- Custom migration (hand-written SQL; ADR 0032).";
/**
 * A first line claiming to be hand-written, however it spells the claim: the marker's own two
 * words, anywhere in that line and in any casing, the `--` and its spacing let go with the
 * rest. The case below then holds that line to the whole marker, because a near-miss — a
 * second citation inside the brackets, prose carried on past the full stop, a lost capital —
 * reads as drizzle-generated instead, and is held to a rule it was never written to answer
 * while saying nothing about the mismatch. The loose match costs no generated migration its
 * check: drizzle-kit writes DDL, and nothing it emits says these two words.
 */
const CLAIMS_TO_BE_HAND_WRITTEN = /custom migration/iu;
/** A migration's first line, the only line the marker may occupy. */
const firstLineOf = (sql: string): string => sql.split("\n", 1)[0] ?? "";
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

  /**
   * The predicate held both ways over lines written down here, because the case after this one
   * walks the tracked tree and skips what makes no claim: a predicate that matched nothing
   * would skip every migration there is and pass in silence, which is the very shape of
   * failure this ticket exists to remove. Three lines claim to be hand-written and none is the
   * marker — the one `0018` carried until this ticket, and the two slips, a lost space and a
   * lost capital, that a prefix match would have waved back into the generated set. The marker
   * itself must read as a claim or every hand-written file would be skipped, and drizzle-kit's
   * own DDL must not, or a generated migration would escape the rule it is held to.
   */
  it("reads a near-miss as a claim, and reads generated DDL as no claim at all", () => {
    for (const nearMiss of [
      "-- Custom migration (hand-written SQL; ADR 0031, ADR 0032).",
      "--Custom migration (hand-written SQL; ADR 0032).",
      "-- custom migration (hand-written SQL; ADR 0032).",
    ]) {
      expect
        .soft(CLAIMS_TO_BE_HAND_WRITTEN.test(nearMiss), `${nearMiss} claims to be hand-written`)
        .toBe(true);
      expect.soft(nearMiss, `${nearMiss} is a near-miss, not the marker`).not.toBe(CUSTOM_MARKER);
    }

    expect(CLAIMS_TO_BE_HAND_WRITTEN.test(CUSTOM_MARKER)).toBe(true);
    expect(CLAIMS_TO_BE_HAND_WRITTEN.test('CREATE TABLE "account" (')).toBe(false);
    expect(
      CLAIMS_TO_BE_HAND_WRITTEN.test('ALTER TABLE "suggestion" FORCE ROW LEVEL SECURITY;'),
    ).toBe(false);
  });

  it("spells the marker exactly on every migration that claims to be hand-written", () => {
    for (const [position, file] of journalMigrationFiles().entries()) {
      const first = firstLineOf(readFileSync(file, "utf8"));
      if (!CLAIMS_TO_BE_HAND_WRITTEN.test(first)) continue;
      const tag = journalEntries()[position]?.tag ?? path.basename(file);
      // The marker written down here rather than read from the constant: the constant is the
      // gate, so a file that cites one more ADR on the line, or runs its explanation on past
      // the full stop, fails here rather than passing as drizzle's own work.
      expect
        .soft(first, `${tag}.sql claims to be hand-written, so its first line must be the marker`)
        .toBe("-- Custom migration (hand-written SQL; ADR 0032).");
    }
  });

  it("never touches `index` or the graph tables from a generated migration", () => {
    for (const [position, file] of journalMigrationFiles().entries()) {
      const sql = readFileSync(file, "utf8");
      if (firstLineOf(sql) === CUSTOM_MARKER) continue;
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
  const destination = path.join(trees, `meta-${String(++copies)}`);
  cpSync(journalMetaFolder, destination, { recursive: true });
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
 * **The byte drizzle-kit leaves off.** `_journal.json` is the one file in `meta/` the tool
 * rewrites on every `generate`, and it writes it without a final newline — so the file's last
 * line turns up in the diff of any generate run that touched the journal, whatever else that
 * run changed. No formatter covers `migrations/`, so nothing put it back. `generate` is a node
 * script that restores it (`scripts/generate-migrations.ts`), and the tracked file and that
 * script's function are held separately below: a `generate` run with nothing to propose leaves
 * the journal untouched, so running the wrapper is no proof that either one is right.
 */

/** A journal as drizzle-kit hands it over: well-formed, and one byte short at the end. */
const A_JOURNAL_AS_DRIZZLE_KIT_WRITES_IT = '{\n  "version": "7",\n  "entries": []\n}';

/** A throwaway folder holding a `_journal.json` that reads exactly as it is spelled here. */
const aFolderHoldingAJournalThatReads = (text: string): string => {
  const folder = mkdtempSync(path.join(trees, "written-"));
  writeFileSync(path.join(folder, "_journal.json"), text);
  return folder;
};

describe("the journal's final newline", () => {
  it("is the last byte of the tracked journal", () => {
    // The raw bytes, not the parsed document: `JSON.parse` answers the same entries with the
    // byte or without it, and the byte is the whole of what a reader sees in the diff.
    const journal = readFileSync(path.join(journalMetaFolder, "_journal.json"));

    expect(journal.at(-1)).toBe(0x0a);
  });

  it("is put back on a journal written without it", () => {
    const folder = aFolderHoldingAJournalThatReads(A_JOURNAL_AS_DRIZZLE_KIT_WRITES_IT);
    restoreFinalNewline(folder);

    expect(readFileSync(path.join(folder, "_journal.json"), "utf8")).toBe(
      `${A_JOURNAL_AS_DRIZZLE_KIT_WRITES_IT}\n`,
    );
  });

  it("is left alone on a journal that already ends in one", () => {
    // The other direction, and the one that matters from the second `generate` onwards: a
    // fixer that appends whatever it is handed passes the case above and then adds a blank
    // line on every run, which is the gratuitous last-line diff the wrapper exists to stop.
    const folder = aFolderHoldingAJournalThatReads(`${A_JOURNAL_AS_DRIZZLE_KIT_WRITES_IT}\n`);
    restoreFinalNewline(folder);

    expect(readFileSync(path.join(folder, "_journal.json"), "utf8")).toBe(
      `${A_JOURNAL_AS_DRIZZLE_KIT_WRITES_IT}\n`,
    );
  });
});

/**
 * **The declarations against the DDL beneath them.** Everything above reads files the journal
 * already holds and holds them against each other; none of it opens `src/`, which is where the
 * one drift this repository has actually had lived. `account.updated_at` carried `.defaultNow()`
 * in its declaration from T-004 and no migration ever landed the `DEFAULT now()`, so every
 * `drizzle-kit generate` run for thirty-three migrations proposed the same `ALTER` and four
 * T-120 iterations stripped it from a family's migration by hand — while this suite and the
 * worker-view drift suite stayed green the whole time, because neither compares a declaration
 * to the DDL. T-138 landed the migration; this is what stops the next such gap standing open
 * as long as that one did.
 *
 * It is `generate`'s own arithmetic rather than a re-implementation of it, run in-process
 * through `drizzle-kit/api`: the declarations become a snapshot, that snapshot is diffed
 * against the newest one in `meta/`, and a tree with nothing left to propose is an empty list
 * of statements. No Postgres and no child process — `generate` is offline, which is why
 * `drizzle.config.ts` carries no `dbCredentials`.
 *
 * The second case is what makes the first one mean something. A checker pointed at the wrong
 * module, or diffing a snapshot against itself, answers "nothing to propose" for every tree
 * there is; so the differ is handed the newest snapshot minus a single column default and read
 * back for the one statement that restores it — which is `0033`'s whole body, word for word.
 */

/** `0033_the-account-timestamp-default.sql` in full, spelled here rather than read from it. */
const THE_ALTER_THAT_LANDED_THE_DEFAULT =
  'ALTER TABLE "account" ALTER COLUMN "updated_at" SET DEFAULT now();';

/**
 * The snapshot of the newest migration, taken from the journal's own walk rather than by naming
 * a tag, so the migration after this one needs no edit here. `journalSnapshots` answers them in
 * the journal's order, and the last of them is the schema as the last migration left it.
 */
const theNewestSnapshot = (): DrizzleSnapshotJSON => {
  const walked = journalSnapshots();
  const newest = walked.ok ? walked.value.at(-1) : undefined;
  if (newest === undefined) throw new Error("there is no newest snapshot to diff against");
  return JSON.parse(
    readFileSync(path.join(journalMetaFolder, newest), "utf8"),
  ) as DrizzleSnapshotJSON;
};

/** The declarations as a snapshot, filtered to `public` as the config filters them. */
const theDeclarations = (prevId: string): DrizzleSnapshotJSON =>
  generateDrizzleJson(declarations, prevId, ["public"]);

describe("the declarations and the DDL generated from them", () => {
  it("leaves a generate run on this tree with nothing to propose", async () => {
    const newest = theNewestSnapshot();

    expect(await generateMigration(newest, theDeclarations(newest.id))).toEqual([]);
  });

  it("proposes the ALTER when a default is in the declarations and not in the DDL", async () => {
    // T-138's own drift, staged back: the newest snapshot with `account.updated_at`'s default
    // taken out of it is what `meta/` held for thirty-three migrations, and the statement below
    // is what `generate` proposed on every one of those runs.
    const before = structuredClone(theNewestSnapshot());
    const column = before.tables["public.account"]?.columns["updated_at"];
    if (column === undefined) throw new Error("account.updated_at is not in the newest snapshot");
    delete column.default;

    expect(await generateMigration(before, theDeclarations(before.id))).toEqual([
      THE_ALTER_THAT_LANDED_THE_DEFAULT,
    ]);
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
