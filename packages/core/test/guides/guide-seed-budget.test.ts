import { assert, describe, expect, it } from "vitest";

import { coverageOf, seedGuide } from "../../src/guides/index.ts";
import { northgate, NORTHGATE, type Northgate } from "../fixtures/northgate.ts";
import { doorsOf, suiteWithBundles } from "../fixtures/workspace-with-bundle.ts";
import { percentile, recordFigures } from "../support/figures.ts";
import { answered, readingAs, seedingWith } from "../support/suite-postgres.ts";

const { db, arrange } = suiteWithBundles();

const CONCEPTS = 3_000;
const SEEDS = 10;
const COVERAGE_READS = 50;

const GUIDE_SEED_BUDGET_TIMEOUT_MS = 600_000;

const inTenthsOfMs = (value: number): string => `${value.toFixed(1)} ms`;

const northgateAmongThousands = async (): Promise<Northgate> => {
  const scenario = await arrange();
  const { workspaceId } = scenario;
  await seedingWith(db().pool, async (seed) => {
    const commitSha = (await seed.bundleCommit({ workspaceId })).sha;
    for (let at = 0; at < CONCEPTS; at += 1) {
      const { iri } = await seed.conceptIdentity({ workspaceId });
      await seed.conceptIndex({ workspaceId, iri, commitSha, path: `knowledge/budget/${at}.md` });
    }
  });
  const ng = await northgate(db(), scenario);
  await db().pool.query("ANALYZE concept_index, write_up_include");
  return ng;
};

const includesOf = async (workspaceId: string, guideId: string): Promise<number> => {
  const found = await db().pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM write_up_include i
       JOIN write_up w ON w.workspace_id = i.workspace_id AND w.id = i.write_up_id
      WHERE w.workspace_id = $1 AND w.guide_id = $2`,
    [workspaceId, guideId],
  );
  return found.rows[0]?.n ?? -1;
};

const timedSeeds = async (ng: Northgate) => {
  const seeds: { readonly ms: number; readonly guideId: string; readonly includes: number }[] = [];
  for (let at = 0; at < SEEDS; at += 1) {
    const started = performance.now();
    const seeded = answered(
      await seedGuide(ng.admin, doorsOf(ng.scenario), {
        templateId: "bid-library",
        collection: NORTHGATE.collection,
        subjectIri: null,
      }),
    );
    const ms = performance.now() - started;
    seeds.push({
      ms,
      guideId: seeded.guideId,
      includes: await includesOf(ng.scenario.workspaceId, seeded.guideId),
    });
  }
  return seeds;
};

const coverageReadMs = async (ng: Northgate, guideId: string) =>
  answered(
    await readingAs(db().pool, ng.admin, async (principal, tx) => {
      const started = performance.now();
      const coverage = answered(await coverageOf(principal, tx, guideId));
      return { ms: performance.now() - started, sections: coverage?.sections.length ?? 0 };
    }),
  );

describe("seeding a guide at 3,000 concepts", () => {
  it(
    "records seeding a guide and reading its coverage",
    async () => {
      const ng = await northgateAmongThousands();

      const seeds = await timedSeeds(ng);
      const [first] = seeds;
      assert(first !== undefined, "no guide was seeded");
      const reads: { readonly ms: number; readonly sections: number }[] = [];
      for (let read = 0; read < COVERAGE_READS; read += 1) {
        reads.push(await coverageReadMs(ng, first.guideId));
      }

      await recordFigures("Seeding a guide and reading its coverage at 3,000 concepts", [
        [
          "seedGuide for the bid library at the median",
          inTenthsOfMs(
            percentile(
              seeds.map((seed) => seed.ms),
              0.5,
            ),
          ),
        ],
        [
          "coverageOf for that guide at the median",
          inTenthsOfMs(
            percentile(
              reads.map((read) => read.ms),
              0.5,
            ),
          ),
        ],
      ]);
      expect(seeds.map((seed) => seed.includes)).toEqual(Array.from({ length: SEEDS }, () => 24));
      expect(reads.map((read) => read.sections)).toEqual(
        Array.from({ length: COVERAGE_READS }, () => 8),
      );
    },
    GUIDE_SEED_BUDGET_TIMEOUT_MS,
  );
});
