import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { declaredTableNames } from "../scripts/worker-view.ts";
import { CROSS_OWNER_TABLE_ACCESS, NON_SLICE_OWNERS, TABLE_OWNERS } from "../src/index.ts";

/**
 * The table-ownership map ADR 0029 promised, held to the declarations.
 *
 * ADR 0029 names the failure no import-direction linter can see: one slice writing SQL
 * against another slice's tables works perfectly, because it is the same database. The
 * mitigation it names first is this map, "reviewed like the export list" — so the map is
 * only worth having if it cannot go stale, which is what this file is for. Two
 * assertions, each in both directions (`[TEST7]`): every declared table names an owner
 * and every entry names a declared table; every owner named — by the map or by a
 * cross-owner entry — is a slice directory that exists, or one of the two owners that is
 * not a slice and says so by naming its path.
 */

const REPO_ROOT = new URL("../../../", import.meta.url);
const CORE_SLICES = new URL("packages/core/src/", REPO_ROOT);

/** ADR 0029: `kernel` and `store` sit under `core/src/` and are not slices. */
const NOT_SLICES = new Set(["kernel", "store"]);

const sliceDirectories = (): Set<string> =>
  new Set(
    readdirSync(fileURLToPath(CORE_SLICES), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !NOT_SLICES.has(entry.name))
      .map((entry) => entry.name),
  );

const isDirectory = (repoRelativePath: string): boolean => {
  const resolved = fileURLToPath(new URL(repoRelativePath, REPO_ROOT));
  return statSync(resolved, { throwIfNoEntry: false })?.isDirectory() === true;
};

const ownersNamed = (): string[] => [
  ...new Set([
    ...Object.values(TABLE_OWNERS),
    ...CROSS_OWNER_TABLE_ACCESS.map((entry) => entry.by),
  ]),
];

describe("the table-ownership map", () => {
  it("names an owner for every table the schema package declares, and names no other table", () => {
    // Both directions: one finds the table that landed without an owner, the other the
    // entry left behind by a table that was renamed or removed.
    expect(Object.keys(TABLE_OWNERS).toSorted()).toEqual([...declaredTableNames()].toSorted());
  });

  it("gives a reader a reason for every cross-owner read and write, against a declared table", () => {
    for (const entry of CROSS_OWNER_TABLE_ACCESS) {
      expect({
        table: entry.table,
        declared: declaredTableNames().has(entry.table),
        reasoned: entry.reason.trim().length > 0,
      }).toEqual({ table: entry.table, declared: true, reasoned: true });
    }
  });

  it("records a cross-owner entry only where the reader is not the table's owner", () => {
    // An entry whose reader is the owner is noise: it says nothing a reader of the map
    // could not read off the owner column, and it hides the entries that do carry news.
    for (const entry of CROSS_OWNER_TABLE_ACCESS) {
      expect({ table: entry.table, by: entry.by }).not.toEqual({
        table: entry.table,
        by: TABLE_OWNERS[entry.table as keyof typeof TABLE_OWNERS],
      });
    }
  });
});

describe("every owner the map names", () => {
  it("is a slice directory that exists in packages/core/src, or one of the two owners that is not a slice", () => {
    const slices = sliceDirectories();
    for (const owner of ownersNamed()) {
      const known = (NON_SLICE_OWNERS as readonly string[]).includes(owner) || slices.has(owner);
      expect({ owner, known }).toEqual({ owner, known: true });
    }
  });

  it("reaches a module a reader can open: a slice's directory, or the path a non-slice owner is written as", () => {
    // A slice is named by its directory alone (`workspaces`); an owner that is not a
    // slice is written as the repository path of the module that is one — a form no
    // slice name can take, so the two can never be confused — and that path exists.
    // A future slice's name would pass neither, which is why a table whose owner does
    // not exist yet is recorded in the map's words rather than in the record.
    for (const owner of NON_SLICE_OWNERS) {
      expect({ owner, path: owner.includes("/"), exists: isDirectory(owner) }).toEqual({
        owner,
        path: true,
        exists: true,
      });
    }
  });

  it("is one the map still uses, so a name nobody owns a table by cannot linger", () => {
    // The pair's other direction (`[TEST7]`): the first test finds an owner the list
    // does not admit, this one the admitted name no table names back.
    const named = new Set(ownersNamed());
    for (const owner of NON_SLICE_OWNERS) {
      expect({ owner, used: named.has(owner) }).toEqual({ owner, used: true });
    }
  });
});
