import { beforeAll, describe, expect, it } from "vitest";

import { erasureMapOf, subjectNamedBy, subjectRequestFor } from "../../src/erasure/index.ts";
import { footnotesOf } from "../../src/guides/index.ts";
import { withScope } from "../../src/store/postgres/index.ts";
import { suiteWithBundles, type Scenario } from "../fixtures/workspace-with-bundle.ts";
import { percentile, recordFigures } from "../support/figures.ts";
import { bootstrap } from "../support/platform.ts";
import { addressOf, answered, readingAs, seedingWith } from "../support/suite-postgres.ts";

const { db, arrange } = suiteWithBundles();

const CONCEPTS = 3_000;
const INCLUDES = 25;
const FOOTNOTE_READS = 50;
const MAP_READS = 20;

const inTenthsOfMs = (value: number): string => `${value.toFixed(1)} ms`;

type Seeded = {
  readonly scenario: Scenario;
  readonly writeUpId: string;
  readonly subjectRequestId: string;
};

const seedTheGuideRecords = async (): Promise<Seeded> => {
  const scenario = await arrange();
  const { workspaceId } = scenario;
  const seeded = await seedingWith(db().pool, async (seed) => {
    const commitSha = (await seed.bundleCommit({ workspaceId })).sha;
    const iris: string[] = [];
    for (let at = 0; at < CONCEPTS; at += 1) {
      const { iri } = await seed.conceptIdentity({ workspaceId });
      await seed.conceptIndex({ workspaceId, iri, commitSha, path: `knowledge/budget/${at}.md` });
      iris.push(iri);
    }
    const writeUp = await seed.writeUp({ workspaceId });
    for (const [ordinal, iri] of iris.slice(0, INCLUDES).entries()) {
      await seed.writeUpInclude({ workspaceId, writeUpId: writeUp.id, iri, ordinal });
    }
    const request = await seed.subjectRequest({
      workspaceId,
      kind: "erasure",
      personId: null,
      identifiers: { emails: [addressOf("nobody")], names: [], other: [] },
    });
    return { writeUpId: writeUp.id, subjectRequestId: request.id };
  });
  await db().pool.query("ANALYZE concept_index, write_up_include");
  return { scenario, ...seeded };
};

const footnoteReadMs = async ({ scenario, writeUpId }: Seeded) =>
  answered(
    await readingAs(db().pool, scenario.viewer, async (principal, tx) => {
      const started = performance.now();
      const footnotes = answered(await footnotesOf(principal, tx, writeUpId));
      return { ms: performance.now() - started, footnotes: footnotes?.length ?? 0 };
    }),
  );

const erasureMapReadMs = async ({ scenario, subjectRequestId }: Seeded) => {
  const request = answered(
    await readingAs(db().pool, scenario.admin, (principal, tx) =>
      subjectRequestFor(principal, tx, subjectRequestId),
    ),
  );
  return withScope(bootstrap, scenario.postgres, scenario.workspaceId, async (tx, platform) => {
    const named = await subjectNamedBy(tx, request, null);
    const started = performance.now();
    await erasureMapOf(platform, tx, scenario.git, request, named);
    return performance.now() - started;
  });
};

describe("the guide records' reads at 3,000 concepts", () => {
  let seeded: Seeded;

  beforeAll(async () => {
    seeded = await seedTheGuideRecords();
  }, 600_000);

  it("records the footnote read and the erasure map", async () => {
    const footnoteReads: { readonly ms: number; readonly footnotes: number }[] = [];
    for (let read = 0; read < FOOTNOTE_READS; read += 1) {
      footnoteReads.push(await footnoteReadMs(seeded));
    }
    const mapReads: number[] = [];
    for (let read = 0; read < MAP_READS; read += 1) mapReads.push(await erasureMapReadMs(seeded));

    await recordFigures("Guide records at 3,000 concepts", [
      [
        "footnotesOf for 25 includes, as a Viewer, at the median",
        inTenthsOfMs(
          percentile(
            footnoteReads.map((read) => read.ms),
            0.5,
          ),
        ),
      ],
      [
        "erasureMapOf for a subject holding nothing, at the median",
        inTenthsOfMs(percentile(mapReads, 0.5)),
      ],
    ]);

    expect(footnoteReads.map((read) => read.footnotes)).toEqual(
      Array.from({ length: FOOTNOTE_READS }, () => INCLUDES),
    );
  }, 600_000);
});
