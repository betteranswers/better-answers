import { assert, describe, expect, it } from "vitest";

import {
  allKnowledgeInput,
  exportBundleSnapshot,
  readAllKnowledge,
  readKinds,
} from "../../src/concepts/index.ts";
import type { UserPrincipal } from "../../src/kernel/index.ts";
import { seedWideKnowledge } from "../fixtures/concept-shelf.ts";
import { wideBundle } from "../fixtures/indexed-bundle.ts";
import { suiteWithBundles } from "../fixtures/workspace-with-bundle.ts";
import { inMs, percentile, recordFigures } from "../support/figures.ts";
import { answered, readingAs, runtimePoolFor } from "../support/suite-postgres.ts";

const { db, arrange } = suiteWithBundles();

const CONCEPTS = 3_000;

const ROUNDS = 7;

const PAGE_BUDGET_MS = 200;

const KINDS_BUDGET_MS = 200;

const SNAPSHOT_BUDGET_MS = 5_000;

const SNAPSHOT_AT = new Date("2026-11-05T10:00:00Z");

const CONFIRMED_BEFORE_MS = 60_000;

const readers = runtimePoolFor(db, 1);

const FIRST_PAGE = allKnowledgeInput.parse({
  collections: [],
  sort: { column: "title", desc: false },
  page: 1,
});

const timed = async (work: () => Promise<unknown>): Promise<number> => {
  const started = performance.now();
  await work();
  return performance.now() - started;
};

const measured = async (work: () => Promise<unknown>): Promise<readonly number[]> => {
  await work();
  const waited: number[] = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    waited.push(await timed(work));
  }
  return waited;
};

const figuresOf = (waited: readonly number[]) =>
  [
    ["at the median", inMs(percentile(waited, 0.5))],
    ["at p95", inMs(percentile(waited, 0.95))],
    ["the slowest", inMs(percentile(waited, 1))],
  ] as const;

describe("the Curation budgets at 3,000 concepts", () => {
  it("reads All knowledge and Kinds within their budgets", async () => {
    const scenario = await arrange();
    const admin = scenario.admin;
    await seedWideKnowledge(db().pool, scenario.workspaceId, {
      count: CONCEPTS,
      owners: [admin.userId],
      checker: `human:${admin.userId}`,
    });

    const page = await measured(async () =>
      answered(
        await readingAs(readers(), admin, (principal, tx) =>
          readAllKnowledge(principal, tx, FIRST_PAGE, SNAPSHOT_AT),
        ),
      ),
    );
    const kinds = await measured(async () =>
      answered(await readingAs(readers(), admin, (principal, tx) => readKinds(principal, tx))),
    );

    await recordFigures("All knowledge's first page", figuresOf(page));
    await recordFigures("Kinds", figuresOf(kinds));
    expect(percentile(page, 0.5), "the first page's median, in milliseconds").toBeLessThan(
      PAGE_BUDGET_MS,
    );
    expect(percentile(kinds, 0.5), "Kinds' median, in milliseconds").toBeLessThan(KINDS_BUDGET_MS);
  });

  it("snapshots the knowledge base within its budget", async () => {
    const scenario = await arrange();
    await wideBundle(db(), scenario, CONCEPTS);
    const admin: UserPrincipal = {
      ...scenario.admin,
      secondFactorConfirmedAtMs: SNAPSHOT_AT.getTime() - CONFIRMED_BEFORE_MS,
    };
    let carried = 0;

    const snapshot = await measured(async () => {
      const exported = await exportBundleSnapshot(admin, scenario, { at: SNAPSHOT_AT });
      assert(exported.ok, "the snapshot was refused");
      carried = exported.value.files;
    });

    await recordFigures("The knowledge base snapshot", [
      ...figuresOf(snapshot),
      ["files in the zip", String(carried)],
    ]);
    expect(carried, "the zip holds every concept and the manifest").toBe(CONCEPTS + 1);
    expect(percentile(snapshot, 0.5), "the snapshot's median, in milliseconds").toBeLessThan(
      SNAPSHOT_BUDGET_MS,
    );
  });
});
