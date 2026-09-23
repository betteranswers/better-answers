import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DrizzleSnapshotJSON } from "drizzle-kit/api";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { foldSeparators } from "../scripts/fold-separators.ts";
import { restoreFinalNewline } from "../scripts/journal-newline.ts";
import { AUDIENCE_CHECK, CONCEPT_FRONTMATTER_MAX, SUGGESTION_SET_MAX } from "../src/index.ts";
import {
  journalEntries,
  journalMetaFolder,
  journalMigrationFiles,
  journalSnapshots,
  journalSnapshotsIn,
} from "../src/journal.ts";

import * as declarations from "../src/schema.ts";

const CUSTOM_MARKER = "-- Custom migration (hand-written SQL; ADR 0032).";

const CLAIMS_TO_BE_HAND_WRITTEN = /custom migration/iu;

const firstLineOf = (sql: string): string => sql.split("\n", 1)[0] ?? "";

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

    expect(journalFiles.toSorted()).toEqual(onDisk.toSorted());
  });

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
  it("has a snapshot for every entry, an entry for every snapshot, and one chain through them", () => {
    const read = journalSnapshots();

    expect(read.ok || read.error).toBe(true);
    expect(read.ok && read.value.at(0)).toBe("0000_snapshot.json");
  });

  it("refuses a journal entry whose snapshot is not in the folder", () => {
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

  it("refuses a snapshot whose prevId is not the id of the snapshot before it", () => {
    expect(journalSnapshotsIn(aCopyWithAPlantedLink("0001_snapshot.json"))).toEqual({
      ok: false,
      error: { kind: "chain-broken", earlier: "0000_snapshot.json", later: "0001_snapshot.json" },
    });
  });

  it("refuses a first snapshot that points at something rather than at nothing", () => {
    expect(journalSnapshotsIn(aCopyWithAPlantedLink("0000_snapshot.json"))).toEqual({
      ok: false,
      error: { kind: "chain-unrooted", snapshot: "0000_snapshot.json" },
    });
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

  it("is left alone on a journal that already ends in one", () => {
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
  it("is on a statement's line in every tracked migration, so none reads as a comment line", () => {
    const ownLine = journalMigrationFiles().filter((file) =>
      readFileSync(file, "utf8").split("\n").includes(SEPARATOR),
    );

    expect(ownLine).toEqual([]);
  });

  it("is folded onto the statement above it where drizzle-kit wrote it on its own line", () => {
    const folder = aFolderHoldingAMigrationThatReads(
      `CREATE TABLE a (\n  id text\n);\n${SEPARATOR}\nCREATE TABLE b (id text);\n`,
    );

    expect(foldSeparators(folder)).toEqual(["0000_probe.sql"]);
    expect(migrationIn(folder)).toBe(
      `CREATE TABLE a (\n  id text\n);${SEPARATOR}\nCREATE TABLE b (id text);\n`,
    );
  });

  it("is left where it is when drizzle-kit already wrote it on the statement's line", () => {
    const written = `CREATE TABLE a (id text);${SEPARATOR}\nCREATE TABLE b (id text);\n`;
    const folder = aFolderHoldingAMigrationThatReads(written);

    expect(foldSeparators(folder)).toEqual([]);
    expect(migrationIn(folder)).toBe(written);
  });

  it("leaves a separator with no statement above it alone rather than folding it onto nothing", () => {
    const written = `${SEPARATOR}\nCREATE TABLE a (id text);\n`;
    const folder = aFolderHoldingAMigrationThatReads(written);

    expect(foldSeparators(folder)).toEqual([]);
    expect(migrationIn(folder)).toBe(written);
  });
});

const THE_ALTER_THAT_LANDED_THE_DEFAULT =
  'ALTER TABLE "account" ALTER COLUMN "updated_at" SET DEFAULT now();';

const theNewestSnapshot = (): DrizzleSnapshotJSON => {
  const walked = journalSnapshots();
  const newest = walked.ok ? walked.value.at(-1) : undefined;
  if (newest === undefined) throw new Error("there is no newest snapshot to diff against");
  const text = readFileSync(path.join(journalMetaFolder, newest), "utf8");
  // oxlint-disable-next-line typescript/consistent-type-assertions -- drizzle-kit exports no parser for its own snapshot, and the test hands the file to its differ whole
  return JSON.parse(text) as DrizzleSnapshotJSON;
};

const theDeclarations = (prevId: string): DrizzleSnapshotJSON =>
  generateDrizzleJson(declarations, prevId, ["public"]);

describe("the declarations and the DDL generated from them", () => {
  it("leaves a generate run on this tree with nothing to propose", async () => {
    const newest = theNewestSnapshot();

    expect(await generateMigration(newest, theDeclarations(newest.id))).toEqual([]);
  });

  it("proposes the ALTER when a default is in the declarations and not in the DDL", async () => {
    const before = structuredClone(theNewestSnapshot());
    const column = before.tables["public.account"]?.columns["updated_at"];
    if (column === undefined) throw new Error("account.updated_at is not in the newest snapshot");
    delete column.default;

    expect(await generateMigration(before, theDeclarations(before.id))).toEqual([
      THE_ALTER_THAT_LANDED_THE_DEFAULT,
    ]);
  });
});

const inboxSubstrate = (): string => {
  const file = journalMigrationFiles().find((name) => name.endsWith("the-inbox-substrate.sql"));
  if (file === undefined) throw new Error("the inbox substrate is not in the journal");
  return readFileSync(file, "utf8");
};

describe("what the inbox substrate copies from the schema package", () => {
  it("bounds a set and a frontmatter at the numbers their constants hold", () => {
    const sql = inboxSubstrate();

    expect(sql).toContain(`BETWEEN 1 AND ${SUGGESTION_SET_MAX}`);
    expect(sql).toContain(`between one and ${SUGGESTION_SET_MAX} requests`);
    expect(sql).toContain(`> ${CONCEPT_FRONTMATTER_MAX}`);
    expect(sql).toContain(`of at most ${CONCEPT_FRONTMATTER_MAX} characters`);
  });
});

describe("what the audience substrate copies from the schema package", () => {
  it("ties the word to the array on the graph tables with the one CHECK the declarations carry", () => {
    const file = journalMigrationFiles().find((name) => name.endsWith("audience-substrate.sql"));
    if (file === undefined) throw new Error("the audience substrate is not in the journal");
    const sql = readFileSync(file, "utf8");

    for (const table of ["graph_node", "graph_edge"]) {
      expect(sql).toContain(`"${table}_audience_check" CHECK (${AUDIENCE_CHECK})`);
    }
  });
});
