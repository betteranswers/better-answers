import { describe, expect, it } from "vitest";

import { conceptIriOf, MARK_THE_MATCH_LEAKPROOF, ulid } from "@better-answers/schema";
import { UNMARK_THE_MATCH } from "@better-answers/schema/testing/probes";

import { findConcepts } from "../src/concepts/index.ts";
import { ok, type UserPrincipal } from "../src/kernel/index.ts";
import { planned } from "./planned.ts";
import { seededBy, visibilitySuite } from "./sourced-concept.ts";

const { db, arrange } = visibilitySuite();

const QUERY = "holiday policy";

const HOLIDAY = "Holiday policy";

/** Below about a hundred rows, reading the workspace's concepts whole is cheaper than a GIN probe. */
const INVOICES = 500;

const arrangedWithInvoices = async (): Promise<{
  readonly admin: UserPrincipal;
  readonly workspaceId: string;
}> => {
  const { admin, workspaceId } = await arrange();
  await seededBy(db(), async (seed) => {
    await seed.conceptIndex({
      workspaceId,
      title: HOLIDAY,
      body: "The holiday policy grants twenty-eight days.",
    });
    for (let invoice = 0; invoice < INVOICES; invoice += 1) {
      await seed.conceptIndex({
        workspaceId,
        title: `Invoice ${String(invoice)}`,
        body: `Invoice ${String(invoice)} was paid in full.`,
      });
    }
  });
  // VACUUM flushes GIN's pending list and ANALYZE counts the rows; the planner prices both.
  await db().pool.query("VACUUM ANALYZE concept_index");
  return { admin, workspaceId };
};

const matching = (person: UserPrincipal) =>
  planned(db(), person, async (reader, tx) => {
    const found = await findConcepts(reader, tx, { query: QUERY, strength: "strong", limit: 10 });
    return found.ok ? ok(found.value.map(({ concept }) => concept.title)) : found;
  });

describe("the concept arm's plan, as the api under its policy", () => {
  it("matches through the GIN index on the search column", async () => {
    const { admin } = await arrangedWithInvoices();

    const found = await matching(admin);

    expect(found.answer).toEqual([HOLIDAY]);
    expect(found.indexes).toContain("concept_index_search_gin");
  });

  it("keeps the GIN index for weak matches past a cursor", async () => {
    const { admin } = await arrangedWithInvoices();

    const found = await planned(db(), admin, async (reader, tx) => {
      const read = await findConcepts(reader, tx, {
        query: "holiday policy grants",
        strength: "weak",
        limit: 10,
        after: { matched: 3, rank: 3, key: conceptIriOf(ulid()) },
      });
      return read.ok ? ok(read.value.map(({ concept }) => concept.title)) : read;
    });

    expect(found.answer).toEqual([]);
    expect(found.indexes).toContain("concept_index_search_gin");
  });

  it("cannot use the GIN index unless the match is leakproof", async () => {
    const { admin } = await arrangedWithInvoices();

    await db().pool.query(UNMARK_THE_MATCH);
    const found = await matching(admin).finally(() => db().pool.query(MARK_THE_MATCH_LEAKPROOF));

    expect(found.answer).toEqual([HOLIDAY]);
    expect(found.indexes).not.toContain("concept_index_search_gin");
  });
});
