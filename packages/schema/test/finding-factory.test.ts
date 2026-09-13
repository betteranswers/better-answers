import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { testData } from "./factory.ts";
import { type MigratedPostgres, withRollback } from "./harness.ts";
import { openMigratedPostgres } from "./warm-postgres.ts";

/**
 * The `finding` factory's default `category`, held to the redaction agreement it
 * names — `contracts/redaction/cases.json`, ADR 0031's fixtured form — by reading the
 * fixture rather than restating its words. `packages/core`'s own `REDACTION_CATEGORIES`
 * already holds the TypeScript side of that agreement against this same file
 * (`packages/core/test/redaction.contract.test.ts`); `packages/schema` carries no
 * category list of its own by design, so this suite asks the narrower question: is the
 * factory's own default, seeded through it with no overrides and read back through the
 * select schema, one of the words the agreement declares. The negative case names the
 * one word a prior defect actually seeded and the fixture has never declared — an empty
 * or mis-read set would still pass the first assertion, so this is what says the
 * declared set was read rather than merely non-empty.
 */

const contractsDir = path.resolve(import.meta.dirname, "../../../contracts");
const redactionCases = JSON.parse(
  readFileSync(path.join(contractsDir, "redaction", "cases.json"), "utf8"),
) as { readonly categories: ReadonlyArray<{ readonly category: string }> };
const DECLARED_CATEGORIES = new Set(redactionCases.categories.map((entry) => entry.category));

let db: MigratedPostgres;

beforeAll(async () => {
  db = await openMigratedPostgres();
});

afterAll(async () => {
  await db.stop();
});

describe("the finding factory's default category", () => {
  it("is one of the redaction agreement's own declared categories", async () => {
    const seeded = await withRollback(db.pool, (client) => testData(client).finding());

    expect(DECLARED_CATEGORIES.has(seeded.category)).toBe(true);
  });

  it("is not a word the fixture has never declared", () => {
    expect(DECLARED_CATEGORIES.has("sort-code")).toBe(false);
  });
});
