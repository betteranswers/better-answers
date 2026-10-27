import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { afterAll, assert, describe, expect, it } from "vitest";
import { z } from "zod";

import { foldSeparators } from "../../scripts/fold-separators.ts";
import { restoreFinalNewline } from "../../scripts/journal-newline.ts";
import {
  AUDIENCE_CHECK,
  CONCEPT_FRONTMATTER_MAX,
  SUGGESTION_KINDS_FROM_A_RUN,
  SUGGESTION_KINDS_FROM_THE_APP,
  SUGGESTION_SET_MAX,
} from "../../src/index.ts";
import {
  journalEntries,
  journalMetaFolder,
  journalMigrationFiles,
  journalSnapshots,
  journalSnapshotsIn,
} from "../../src/journal.ts";
import * as declarations from "../../src/schema.ts";

const CUSTOM_MARKER = "-- Custom migration (hand-written SQL; ADR 0032).";

const CLAIMS_TO_BE_HAND_WRITTEN = /custom migration/iu;

const firstLineOf = (sql: string): string => sql.split("\n", 1)[0] ?? "";

const journalledMigrations = (): readonly { readonly tag: string; readonly sql: string }[] =>
  journalMigrationFiles().map((file, position) => ({
    tag: journalEntries()[position]?.tag ?? path.basename(file),
    sql: readFileSync(file, "utf8"),
  }));

const FORBIDDEN_IN_GENERATED = [
  /"index"/u,
  /\bmap_node\b/u,
  /\bmap_edge\b/u,
  /\bmap_generation\b/u,
  /\bmap_unresolved_reference\b/u,
];

describe("the migration journal", () => {
  it("names exactly the .sql files in the migrations folder", () => {
    const journalFiles = journalMigrationFiles().map((file) => path.basename(file));
    const [firstFile] = journalMigrationFiles();
    assert(firstFile !== undefined, "the journal names a migration");
    const migrationsDir = path.dirname(firstFile);
    const onDisk = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql"));

    expect(journalFiles.toSorted()).toEqual(onDisk.toSorted());
  });

  it("counts a near-miss as a claim, but not generated DDL", () => {
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

  it("spells the marker exactly wherever a migration claims it", () => {
    const claiming = journalledMigrations().filter(({ sql }) =>
      CLAIMS_TO_BE_HAND_WRITTEN.test(firstLineOf(sql)),
    );

    expect(
      claiming.length,
      "a migration is hand-written, so the marker rule has something to check",
    ).toBeGreaterThan(0);
    for (const { tag, sql } of claiming) {
      expect
        .soft(
          firstLineOf(sql),
          `${tag}.sql claims to be hand-written, so its first line must be the marker`,
        )
        .toBe("-- Custom migration (hand-written SQL; ADR 0032).");
    }
  });

  it("never touches `index` or map tables in a generated migration", () => {
    const generated = journalledMigrations().filter(
      ({ sql }) => firstLineOf(sql) !== CUSTOM_MARKER,
    );

    expect(
      generated.length,
      "a migration is generated, so the forbidden-table rule has something to check",
    ).toBeGreaterThan(0);
    for (const { tag, sql } of generated) {
      for (const forbidden of FORBIDDEN_IN_GENERATED) {
        expect
          .soft(sql, `${tag}.sql is generated and must not match ${String(forbidden)}`)
          .not.toMatch(forbidden);
      }
    }
  });
});

const NOT_THE_ONE_BEFORE = "11111111-1111-1111-1111-111111111111";
const trees = mkdtempSync(path.join(tmpdir(), "journal-meta-"));
let copies = 0;

afterAll(() => rmSync(trees, { recursive: true, force: true }));

const aCopyOfMeta = (): string => {
  const destination = path.join(trees, `meta-${String(++copies)}`);
  cpSync(journalMetaFolder, destination, { recursive: true });
  return destination;
};

const aCopyWithAPlantedLink = (snapshotName: string): string => {
  const meta = aCopyOfMeta();
  const snapshot = path.join(meta, snapshotName);
  const planted = z
    .looseObject({ prevId: z.string() })
    .parse(JSON.parse(readFileSync(snapshot, "utf8")));
  writeFileSync(snapshot, JSON.stringify({ ...planted, prevId: NOT_THE_ONE_BEFORE }));
  return meta;
};

describe("the journal's meta folder", () => {
  it("pairs entries with snapshots in one unbroken chain", () => {
    const read = journalSnapshots();

    expect(read).toMatchObject({ ok: true });
    assert(read.ok);
    expect(read.value.at(0)).toBe("0000_snapshot.json");
  });

  it("refuses a journal entry whose snapshot is missing", () => {
    const meta = aCopyOfMeta();
    rmSync(path.join(meta, "0001_snapshot.json"));

    expect(journalSnapshotsIn(meta)).toEqual({
      ok: false,

      error: { kind: "snapshot-missing", tag: "0001_first-tables", snapshot: "0001_snapshot.json" },
    });
  });

  it("refuses a snapshot the journal does not name", () => {
    const meta = aCopyOfMeta();
    writeFileSync(path.join(meta, "9999_snapshot.json"), "{}");

    expect(journalSnapshotsIn(meta)).toEqual({
      ok: false,
      error: { kind: "snapshot-orphaned", snapshot: "9999_snapshot.json" },
    });
  });

  it("refuses a snapshot whose prevId is not its predecessor's id", () => {
    expect(journalSnapshotsIn(aCopyWithAPlantedLink("0001_snapshot.json"))).toEqual({
      ok: false,
      error: { kind: "chain-broken", earlier: "0000_snapshot.json", later: "0001_snapshot.json" },
    });
  });

  it("refuses a first snapshot whose prevId points at something", () => {
    expect(journalSnapshotsIn(aCopyWithAPlantedLink("0000_snapshot.json"))).toEqual({
      ok: false,
      error: { kind: "chain-unrooted", snapshot: "0000_snapshot.json" },
    });
  });

  it("checks entries, then snapshots, then the chain", () => {
    const everyFault = aCopyWithAPlantedLink("0002_snapshot.json");
    rmSync(path.join(everyFault, "0001_snapshot.json"));
    writeFileSync(path.join(everyFault, "9999_snapshot.json"), "{}");
    const orphanAndBrokenLink = aCopyWithAPlantedLink("0002_snapshot.json");
    writeFileSync(path.join(orphanAndBrokenLink, "9999_snapshot.json"), "{}");

    expect([journalSnapshotsIn(everyFault), journalSnapshotsIn(orphanAndBrokenLink)]).toMatchObject(
      [
        { ok: false, error: { kind: "snapshot-missing" } },
        { ok: false, error: { kind: "snapshot-orphaned" } },
      ],
    );
  });

  it("throws on a journal or snapshot that does not parse", () => {
    const unreadableJournal = aCopyOfMeta();
    writeFileSync(path.join(unreadableJournal, "_journal.json"), "not a journal");
    const unreadableSnapshot = aCopyOfMeta();
    writeFileSync(path.join(unreadableSnapshot, "0000_snapshot.json"), "{}");

    expect(() => journalSnapshotsIn(unreadableJournal)).toThrow(SyntaxError);
    expect(() => journalSnapshotsIn(unreadableSnapshot)).toThrow(z.ZodError);
  });

  it("throws on a journal instant that does not increase", () => {
    const meta = aCopyOfMeta();
    const journalPath = path.join(meta, "_journal.json");
    const journal = z
      .looseObject({ entries: z.array(z.looseObject({ when: z.number() })) })
      .parse(JSON.parse(readFileSync(journalPath, "utf8")));
    const [first, second, ...rest] = journal.entries;
    assert(first !== undefined, "the journal has a first entry");
    assert(second !== undefined, "the journal has a second entry");
    writeFileSync(
      journalPath,
      JSON.stringify({ ...journal, entries: [first, { ...second, when: first.when }, ...rest] }),
    );

    expect(() => journalSnapshotsIn(meta)).toThrow(/instants must strictly increase/);
  });
});

const A_JOURNAL_AS_DRIZZLE_KIT_WRITES_IT = '{\n  "version": "7",\n  "entries": []\n}';

const aFolderHoldingAJournalThatReads = (text: string): string => {
  const folder = mkdtempSync(path.join(trees, "written-"));
  writeFileSync(path.join(folder, "_journal.json"), text);
  return folder;
};

describe("the journal's final newline", () => {
  it("is the last byte of the tracked journal", () => {
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

  it("is left alone on a journal already ending in one", () => {
    const folder = aFolderHoldingAJournalThatReads(`${A_JOURNAL_AS_DRIZZLE_KIT_WRITES_IT}\n`);
    restoreFinalNewline(folder);

    expect(readFileSync(path.join(folder, "_journal.json"), "utf8")).toBe(
      `${A_JOURNAL_AS_DRIZZLE_KIT_WRITES_IT}\n`,
    );
  });
});

const SEPARATOR = "--> statement-breakpoint";

const aFolderHoldingAMigrationThatReads = (text: string): string => {
  const folder = mkdtempSync(path.join(trees, "generated-"));
  writeFileSync(path.join(folder, "0000_probe.sql"), text);
  return folder;
};

const migrationIn = (folder: string): string =>
  readFileSync(path.join(folder, "0000_probe.sql"), "utf8");

describe("the statement separator the generator writes", () => {
  it("is on a statement's line in every tracked migration", () => {
    const ownLine = journalMigrationFiles().filter((file) =>
      readFileSync(file, "utf8").split("\n").includes(SEPARATOR),
    );

    expect(ownLine).toEqual([]);
  });

  it("is folded from its own line onto the statement above", () => {
    const folder = aFolderHoldingAMigrationThatReads(
      `CREATE TABLE a (\n  id text\n);\n${SEPARATOR}\nCREATE TABLE b (id text);\n`,
    );

    expect(foldSeparators(folder)).toEqual(["0000_probe.sql"]);
    expect(migrationIn(folder)).toBe(
      `CREATE TABLE a (\n  id text\n);${SEPARATOR}\nCREATE TABLE b (id text);\n`,
    );
  });

  it("is left in place when already on the statement's line", () => {
    const written = `CREATE TABLE a (id text);${SEPARATOR}\nCREATE TABLE b (id text);\n`;
    const folder = aFolderHoldingAMigrationThatReads(written);

    expect(foldSeparators(folder)).toEqual([]);
    expect(migrationIn(folder)).toBe(written);
  });

  it("is left alone with no statement above it", () => {
    const written = `${SEPARATOR}\nCREATE TABLE a (id text);\n`;
    const folder = aFolderHoldingAMigrationThatReads(written);

    expect(foldSeparators(folder)).toEqual([]);
    expect(migrationIn(folder)).toBe(written);
  });
});

const THE_ALTER_THAT_LANDED_THE_DEFAULT =
  'ALTER TABLE "account" ALTER COLUMN "updated_at" SET DEFAULT now();';

const snapshotSchema = z.looseObject({
  id: z.string(),
  tables: z.record(
    z.string(),
    z.looseObject({
      columns: z.record(z.string(), z.looseObject({ default: z.unknown().optional() })),
    }),
  ),
});

type Snapshot = z.infer<typeof snapshotSchema>;

const theNewestSnapshot = (): Snapshot => {
  const walked = journalSnapshots();
  const newest = walked.ok ? walked.value.at(-1) : undefined;
  if (newest === undefined) throw new Error("there is no newest snapshot to diff against");
  const text = readFileSync(path.join(journalMetaFolder, newest), "utf8");
  return snapshotSchema.parse(JSON.parse(text));
};

/** drizzle-kit's declaration types import zod 3, which it does not install, so its snapshot type does not resolve. */
const theDeclarations = (prevId: string): unknown =>
  generateDrizzleJson(declarations, prevId, ["public"]);

describe("the declarations and the DDL generated from them", () => {
  it("leaves a generate run on this tree nothing to propose", async () => {
    const newest = theNewestSnapshot();

    expect(await generateMigration(newest, theDeclarations(newest.id))).toEqual([]);
  });

  it("proposes the ALTER for a default missing from the DDL", async () => {
    const before = structuredClone(theNewestSnapshot());
    const column = before.tables["public.account"]?.columns["updated_at"];
    assert(column !== undefined, "account.updated_at is in the newest snapshot");
    delete column.default;

    expect(await generateMigration(before, theDeclarations(before.id))).toEqual([
      THE_ALTER_THAT_LANDED_THE_DEFAULT,
    ]);
  });
});

const theSuggestionFunction = (): string => {
  const sql = journalMigrationFiles()
    .map((file) => readFileSync(file, "utf8"))
    .findLast((text) => /FUNCTION (?:public\.)?submit_suggestion_set\(/u.test(text));
  if (sql === undefined) throw new Error("no migration in the journal writes the function");
  return sql;
};

const arrayOf = (kinds: readonly string[]): string =>
  `ARRAY[${kinds.map((kind) => `'${kind}'`).join(", ")}]`;

describe("what the suggestion function copies from the schema package", () => {
  it("bounds a set and a frontmatter at their constants", () => {
    const sql = theSuggestionFunction();

    expect(sql).toContain(`BETWEEN 1 AND ${SUGGESTION_SET_MAX}`);
    expect(sql).toContain(`between one and ${SUGGESTION_SET_MAX} requests`);
    expect(sql).toContain(`> ${CONCEPT_FRONTMATTER_MAX}`);
    expect(sql).toContain(`of at most ${CONCEPT_FRONTMATTER_MAX} characters`);
  });

  it("lets each tier raise the kinds the schema package lists", () => {
    const sql = theSuggestionFunction();

    expect(sql).toContain(`WHEN 'app_rt' THEN ${arrayOf(SUGGESTION_KINDS_FROM_THE_APP)}`);
    expect(sql).toContain(`WHEN 'worker_rt' THEN ${arrayOf(SUGGESTION_KINDS_FROM_A_RUN)}`);
  });
});

describe("what the audience substrate copies from the schema package", () => {
  it("uses the declared audience CHECK on both map tables", () => {
    const file = journalMigrationFiles().find((name) => name.endsWith("audience-substrate.sql"));
    assert(file !== undefined, "the audience substrate is in the journal");
    const sql = readFileSync(file, "utf8");

    for (const table of ["graph_node", "graph_edge"]) {
      expect(sql, "the substrate predates 0067, so it names graph_node and graph_edge").toContain(
        `"${table}_audience_check" CHECK (${AUDIENCE_CHECK})`,
      );
    }
  });
});
