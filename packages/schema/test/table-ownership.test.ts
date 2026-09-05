import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { declaredTableNames } from "../scripts/worker-view.ts";
import {
  CROSS_OWNER_TABLE_ACCESS,
  IDENTITY_PROVIDER,
  IDENTITY_SET,
  OWNERS_OUTSIDE_CORE,
  TABLE_OWNERS,
} from "../src/index.ts";

/**
 * The table-ownership map ADR 0029 promised, held to the declarations.
 *
 * ADR 0029 names the failure no import-direction linter can see: one slice writing SQL
 * against another slice's tables works perfectly, because it is the same database. The
 * mitigation it names first is this map, "reviewed like the export list" — so the map is
 * only worth having if it cannot go stale, which is what this file is for. Three pairs,
 * each asserted both ways (`[TEST7]`): the map against the declared tables, the identity
 * provider's rows against `IDENTITY_SET`, and every owner named against the directories
 * that exist.
 */

const REPO_ROOT = new URL("../../../", import.meta.url);

/**
 * ADR 0029: `kernel` and `store` sit under `core/src/` and own no table of their own —
 * the Postgres door owns the counters and is named by its path, one level further down.
 * A map entry naming either would be a name a reader could not act on.
 */
const NEVER_AN_OWNER = new Set(["kernel", "store"]);

const coreDirectories = (): Set<string> =>
  new Set(
    readdirSync(fileURLToPath(new URL("packages/core/src/", REPO_ROOT)), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !NEVER_AN_OWNER.has(entry.name))
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

  it("gives the identity provider exactly the identity set, so the one copied list cannot drift", () => {
    // The sixteen rows are written out, as `RLS_EXEMPTIONS` is, so the map reads whole.
    // Held equal to `IDENTITY_SET` in both directions: one direction finds the identity
    // table that gained a slice owner, the other the row left behind by a table the
    // library no longer declares.
    const provided = Object.entries(TABLE_OWNERS)
      .filter(([, owner]) => owner === IDENTITY_PROVIDER)
      .map(([table]) => table);
    expect(provided.toSorted()).toEqual([...IDENTITY_SET].toSorted());
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
        by: TABLE_OWNERS[entry.table],
      });
    }
  });
});

describe("every owner the map names", () => {
  it("reaches a module a reader can open — a directory under packages/core/src, or a path to one outside it", () => {
    // A module inside `core` is named by its directory alone (`workspaces`, and `llm`,
    // which owns a table without being a slice — ADR 0029 rule 3); a module outside it is
    // named by its repository path, a form a directory name there cannot take. A future
    // slice's name would pass neither, which is why a table whose owner does not exist
    // yet is recorded in the map's words rather than in the record.
    const inCore = coreDirectories();
    for (const owner of ownersNamed()) {
      const opens = (OWNERS_OUTSIDE_CORE as readonly string[]).includes(owner)
        ? isDirectory(owner)
        : inCore.has(owner);
      expect({ owner, opens }).toEqual({ owner, opens: true });
    }
  });

  it("is one the map still uses, so a path admitted for an owner that left cannot linger", () => {
    // The pair's other direction (`[TEST7]`): the test above finds an owner the map
    // admits nowhere, this one the admitted path no table names back.
    const named = new Set(ownersNamed());
    for (const owner of OWNERS_OUTSIDE_CORE) {
      expect({ owner, used: named.has(owner) }).toEqual({ owner, used: true });
    }
  });
});
