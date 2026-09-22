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

const REPO_ROOT = new URL("../../../", import.meta.url);

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
    expect(Object.keys(TABLE_OWNERS).toSorted()).toEqual([...declaredTableNames()].toSorted());
  });

  it("gives the identity provider exactly the identity set, so the one copied list cannot drift", () => {
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
    const inCore = coreDirectories();
    for (const owner of ownersNamed()) {
      const opens = OWNERS_OUTSIDE_CORE.some((known) => known === owner)
        ? isDirectory(owner)
        : inCore.has(owner);
      expect({ owner, opens }).toEqual({ owner, opens: true });
    }
  });

  it("is one the map still uses, so a path admitted for an owner that left cannot linger", () => {
    const named = new Set(ownersNamed());
    for (const owner of OWNERS_OUTSIDE_CORE) {
      expect({ owner, used: named.has(owner) }).toEqual({ owner, used: true });
    }
  });
});
