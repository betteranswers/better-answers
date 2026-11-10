import { assert, describe, expect, it } from "vitest";

import {
  allKnowledgeInput,
  collectionsAndOwners,
  exportBundleSnapshot,
  readAllKnowledge,
  readConceptTypes,
} from "@better-answers/core/concepts";
import type { UserPrincipal } from "@better-answers/core/kernel";

import { seedWideKnowledge } from "../fixtures/concept-shelf.ts";
import { wideBundle } from "../fixtures/indexed-bundle.ts";
import { suiteWithBundles } from "../fixtures/workspace-with-bundle.ts";
import { inMs, percentile, recordFigures } from "../support/figures.ts";
import { answered, readingAs, runtimePoolFor } from "../support/suite-postgres.ts";

const { db, arrange } = suiteWithBundles();

const CONCEPTS = 3_000;

const ROUNDS = 7;

const PAGE_BUDGET_MS = 200;

const CONCEPT_TYPES_BUDGET_MS = 200;

const SNAPSHOT_BUDGET_MS = 5_000;

const SNAPSHOT_AT = new Date("2026-11-05T10:00:00Z");

const CONFIRMED_BEFORE_MS = 60_000;

const readers = runtimePoolFor(db, 1);

const FIRST_PAGE = allKnowledgeInput.parse({
  collections: [],
  sort: { column: "title", desc: false },
  page: 1,
});

const TRUSTED_PAGE = allKnowledgeInput.parse({
  collections: [],
  trust: "unverified",
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
  it("reads All knowledge and Concept Types within their budgets", async () => {
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
    const trusted = await measured(async () =>
      answered(
        await readingAs(readers(), admin, (principal, tx) =>
          readAllKnowledge(principal, tx, TRUSTED_PAGE, SNAPSHOT_AT),
        ),
      ),
    );
    const collections = await measured(async () =>
      answered(
        await readingAs(readers(), admin, (principal, tx) =>
          collectionsAndOwners(principal, tx, SNAPSHOT_AT),
        ),
      ),
    );
    const conceptTypes = await measured(async () =>
      answered(
        await readingAs(readers(), admin, (principal, tx) => readConceptTypes(principal, tx)),
      ),
    );

    await recordFigures("All knowledge's first page", figuresOf(page));
    await recordFigures("All knowledge filtered by trust", figuresOf(trusted));
    await recordFigures("Collections and Owners", figuresOf(collections));
    await recordFigures("Concept Types", figuresOf(conceptTypes));
    expect(
      percentile(page, 0.5),
      "All knowledge's first page at the median, in milliseconds",
    ).toBeLessThan(PAGE_BUDGET_MS);
    expect(
      percentile(trusted, 0.5),
      "All knowledge filtered by trust at the median, in milliseconds",
    ).toBeLessThan(PAGE_BUDGET_MS);
    expect(
      percentile(collections, 0.5),
      "Collections and Owners at the median, in milliseconds",
    ).toBeLessThan(PAGE_BUDGET_MS);
    expect(
      percentile(conceptTypes, 0.5),
      "the Concept Types read at the median, in milliseconds",
    ).toBeLessThan(CONCEPT_TYPES_BUDGET_MS);
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
    expect(carried, "the files in the zip: every concept plus the manifest").toBe(CONCEPTS + 1);
    expect(percentile(snapshot, 0.5), "the snapshot's median, in milliseconds").toBeLessThan(
      SNAPSHOT_BUDGET_MS,
    );
  });
});
