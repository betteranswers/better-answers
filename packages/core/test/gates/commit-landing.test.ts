import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  asSliceRelative,
  coreSourceFiles,
  sourceTreeIsInstrumented,
} from "../support/source-tree.ts";

const PAIRING_WRITES: Readonly<Record<string, string>> = {
  "bundle/index.ts: INSERT INTO bundle_commit":
    "landBundleCommit, which landRows and the commits that change no concept file call",
  "concepts/import/landing.ts: INSERT INTO concept_index":
    "landRows, which records the commit with landBundleCommit in the same transaction",
  "concepts/import/landing.ts: UPDATE bundle_commit":
    "moveBundleCommits, which moves the index rows' commits in the same transaction",
  "concepts/import/landing.ts: UPDATE concept_index":
    "moveBundleCommits, which moves the recorded commits in the same transaction",
};

const RECORDS_NO_CONCEPT_FILE: Readonly<Record<string, string>> = {
  "concepts/import/landing.ts": "landRows lands the index rows of the commit it records",
  "concepts/import/manifest.ts": "a manifest commit changes no concept file",
  "concepts/writes/reconciler.ts": "replays only a manifest or skeleton commit through it",
  "guides/skeleton.ts": "a guide skeleton commit changes no concept file",
};

const WRITE = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(bundle_commit|concept_index)\b([^`"]*)/giu;

const PAIRED_COLUMN = /\bSET\b(?:(?!\bWHERE\b)[^`"])*\b(?:path|commit_sha|sha|parent_sha)\s*=/iu;

const verbOf = (verb: string): string => verb.toUpperCase().replaceAll(/\s+/gu, " ");

const pairingWritesIn = (file: string, source: string): readonly string[] =>
  [...source.matchAll(WRITE)]
    .filter(([, verb = "", , rest = ""]) => verbOf(verb) !== "UPDATE" || PAIRED_COLUMN.test(rest))
    .map(([, verb = "", table = ""]) => `${file}: ${verbOf(verb)} ${table}`);

const LANDS_A_COMMIT_ROW = /\blandBundleCommit\(/u;

const DEFINES_IT = /export const landBundleCommit\b/u;

const commitRowLandersIn = (file: string, source: string): readonly string[] =>
  DEFINES_IT.test(source) || !LANDS_A_COMMIT_ROW.test(source) ? [] : [file];

const sources = (): readonly (readonly [string, string])[] =>
  coreSourceFiles().map((file) => [asSliceRelative([file])[0] ?? file, readFileSync(file, "utf8")]);

describe("the index rows an export reads land with their commit", () => {
  it.skipIf(sourceTreeIsInstrumented())(
    "moves index paths and commits only beside their commit row",
    () => {
      const found = sources().flatMap(([file, source]) => pairingWritesIn(file, source));

      expect(found.toSorted()).toEqual(Object.keys(PAIRING_WRITES).toSorted());
    },
  );

  it.skipIf(sourceTreeIsInstrumented())(
    "records a lone commit row only for commits without concepts",
    () => {
      const found = sources().flatMap(([file, source]) => commitRowLandersIn(file, source));

      expect(found.toSorted()).toEqual(Object.keys(RECORDS_NO_CONCEPT_FILE).toSorted());
    },
  );

  it("finds a writer the listing leaves out", () => {
    const stray = "await tx.query(`UPDATE concept_index SET path = $3 WHERE iri = $2`);";
    const visibility = "await tx.query(`UPDATE concept_index SET audience = $3 WHERE iri = $2`);";

    expect(pairingWritesIn("concepts/stray.ts", stray)).toEqual([
      "concepts/stray.ts: UPDATE concept_index",
    ]);
    expect(pairingWritesIn("concepts/visibility.ts", visibility)).toEqual([]);
    expect(
      pairingWritesIn("erasure/actors.ts", "`UPDATE bundle_commit SET actor = $3 WHERE sha = $2`"),
    ).toEqual([]);
    expect(
      commitRowLandersIn("guides/stray.ts", "await landBundleCommit(fresh, tx, landing);"),
    ).toEqual(["guides/stray.ts"]);
  });
});
