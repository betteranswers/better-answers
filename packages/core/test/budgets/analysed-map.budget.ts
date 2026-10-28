import { beforeAll, describe, expect, it } from "vitest";

import { conceptIriOf, ids, ulid, type ConceptIri } from "@better-answers/schema";
import { policiesIndexedInBulk } from "@better-answers/schema/testing/probes";

import { ASK_CAPS, type AnswerResult } from "../../src/answering/index.ts";
import { contentHashOf, renderConceptFile } from "../../src/concepts/index.ts";
import { enqueueJob } from "../../src/runs/index.ts";
import { askedAsIs } from "../answering/asking.ts";
import { treeCommitted } from "../fixtures/bundle.ts";
import { suiteWithBundles, type Scenario } from "../fixtures/workspace-with-bundle.ts";
import { answered, mapAutovacuumOff, seedingWith } from "../support/suite-postgres.ts";
import { runWorkerOnce } from "../support/worker-process.ts";

const { db, bundles, arrange } = suiteWithBundles();

const HUBS = ASK_CAPS.entryPoints;

const SPOKES_EACH = 250;

const NODES = HUBS + HUBS * SPOKES_EACH;

const QUESTION = "How long do we have to claim expenses?";

const REACHED_IRI = ids.conceptIri.parse(`https://better-answers.com/c/${"0".repeat(26)}`);

const SEED_REBUILD_AND_ASK_MS = 300_000;

type WideMap = {
  readonly scenario: Scenario;
  readonly entries: readonly ConceptIri[];
  readonly reached: ConceptIri;
};

const isAHub = (at: number): boolean => at < HUBS;

const pathAt = (at: number): string => `knowledge/wide/node-${at}.md`;

const spokesOf = (hub: number): readonly number[] =>
  Array.from({ length: SPOKES_EACH }, (_unused, step) => HUBS + hub + step * HUBS);

const bodyAt = (at: number): string => {
  if (!isAHub(at)) return "## Details\n\nA rule the question never names.\n";
  const links = spokesOf(at).map((spoke) => `[rule ${spoke}](./node-${spoke}.md)`);
  return `## Details\n\nExpenses are claimed within thirty days. Rule ${at} rests on ${links.join(", ")}.\n`;
};

const seedWideMap = async (scenario: Scenario): Promise<WideMap> => {
  const { workspaceId } = scenario;
  const iris = Array.from({ length: NODES }, (_unused, at) =>
    at === HUBS ? REACHED_IRI : conceptIriOf(ulid()),
  );
  const paths = iris.map((_iri, at) => pathAt(at));
  const titles = iris.map((_iri, at) => `Rule ${at}`);
  const bodies = iris.map((_iri, at) => bodyAt(at));
  const hashes = iris.map((_iri, at) =>
    contentHashOf({ title: titles[at] ?? "", type: "Policy" }, bodies[at] ?? "", paths[at] ?? ""),
  );
  const commitSha = await seedingWith(
    db().pool,
    async (seed) => (await seed.bundleCommit({ workspaceId })).sha,
  );
  await policiesIndexedInBulk(db().pool, {
    workspaceId,
    commitSha,
    concepts: iris.map((iri, at) => ({
      iri,
      path: paths[at] ?? "",
      title: titles[at] ?? "",
      body: bodies[at] ?? "",
      contentHash: hashes[at] ?? "",
    })),
  });
  const files = new Map(
    iris.map((_iri, at) => [
      pathAt(at),
      renderConceptFile({ title: titles[at] ?? "", type: "Policy" }, bodies[at] ?? ""),
    ]),
  );
  await treeCommitted(scenario.git, workspaceId, files, "Land the wide map's bundle");
  return { scenario, entries: iris.filter((_iri, at) => isAHub(at)), reached: REACHED_IRI };
};

const rebuiltByTheWorker = async ({ scenario }: WideMap): Promise<void> => {
  const { workspaceId } = scenario;
  const queued = answered(
    await enqueueJob(scenario.admin, scenario.postgres, {
      workspaceId,
      kind: "full-rebuild",
      reason: "drill",
    }),
  );
  await runWorkerOnce(db().connectionUri, bundles().root, "analysed-map");
  const rebuilt = await db().pool.query<{ status: string; nodes: number; edges: number }>(
    `SELECT (SELECT status FROM job WHERE workspace_id = $1 AND id = $2) AS status,
            (SELECT count(*)::int FROM map_node n JOIN map_generation g USING (workspace_id)
              WHERE n.workspace_id = $1 AND n.gen = g.live_gen) AS nodes,
            (SELECT count(*)::int FROM map_edge e JOIN map_generation g USING (workspace_id)
              WHERE e.workspace_id = $1 AND e.gen = g.live_gen) AS edges`,
    [workspaceId, queued.jobId],
  );
  expect(rebuilt.rows[0], "the rebuild the worker ran").toEqual({
    status: "done",
    nodes: NODES,
    edges: HUBS * SPOKES_EACH,
  });
};

const irisOf = (answer: AnswerResult): readonly ConceptIri[] =>
  answer.related.map((concept) => concept.iri);

describe("asking over a map the worker has just rebuilt", () => {
  beforeAll(async () => {
    await mapAutovacuumOff(db().pool);
  });

  it(
    "answers with the map live and a walked concept",
    async () => {
      const wide = await seedWideMap(await arrange());
      expect(wide.entries, "the concepts the question matches").toHaveLength(HUBS);
      await rebuiltByTheWorker(wide);

      const answer = await askedAsIs(db(), wide.scenario.viewer, { question: QUESTION });

      const iris = irisOf(answer);
      expect({
        map: answer.map,
        entries: iris.slice(0, HUBS).toSorted(),
        reached: iris.includes(wide.reached),
      }).toEqual({ map: { state: "live" }, entries: wide.entries.toSorted(), reached: true });
    },
    SEED_REBUILD_AND_ASK_MS,
  );
});
