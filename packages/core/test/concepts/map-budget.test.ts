import { inspect } from "node:util";

import { assert, beforeAll, describe, expect, it } from "vitest";

import { walkConceptsFromEntries, walkFrom } from "@better-answers/core/store/map";
import { ids, type ConceptIri } from "@better-answers/schema";

import { writeConcept, type WriteConceptInput } from "../../src/concepts/index.ts";
import type { UserPrincipal } from "../../src/kernel/index.ts";
import { enqueueJob } from "../../src/runs/index.ts";
import { doorsOf, suiteWithBundles, type Scenario } from "../fixtures/workspace-with-bundle.ts";
import { alternating, inMs, percentile, recordFigures } from "../support/figures.ts";
import { answered, readingAs, runtimePoolFor, seedingWith } from "../support/suite-postgres.ts";
import { runWorkerOnce } from "../support/worker-process.ts";

const { db, bundles, arrange } = suiteWithBundles();

const CONCEPTS = 30;
const LINKS_EACH = 6;

const EDGES = 159;

const WIDE_NODES = 3_000;

const WIDE_LINKS = [1, 7, 43, 211, 617, 1_499];

const ENTRIES = 40;

const WIDE_COLLECTION = "wide";

const IN_FLIGHT = 10;
const ROUNDS = 5;

const readers = runtimePoolFor(db, IN_FLIGHT);

const CONCEPTS_UNDER_THE_CAP = 1_000;

const WALK_BUDGET_IN_ONE_ROW_WALKS = 100;

const WALK_TIMEOUT_MS = 2_000;

const REBUILD_BUDGET_MS = 120_000;

const bodyOf = (at: number): string => {
  const links: string[] = [];
  for (let target = Math.max(0, at - LINKS_EACH); target < at; target += 1) {
    links.push(`Rule ${at} rests on [rule ${target}](./expenses-${target}.md).`);
  }
  return `## Details\n\nExpenses under rule ${at} are claimed within thirty days.\n\n${links.join("\n\n")}\n`;
};

const writeOf = (at: number, head: string | null): WriteConceptInput => ({
  mergeKey: `policy:expenses-${at}`,
  path: `knowledge/expenses-${at}.md`,
  kind: "Policy",
  title: `Expenses ${at}`,
  frontmatter: { title: `Expenses ${at}`, type: "Policy" },
  body: bodyOf(at),
  message: `Record expenses rule ${at}`,
  author: { name: "Ada Editor", email: "ada@acme.invalid" },
  expects: { head },

  status: "stable",
  sensitivity: "Internal",
});

const landDenseMap = async (scenario: Scenario): Promise<Scenario> => {
  let head: string | null = null;
  for (let at = 0; at < CONCEPTS; at += 1) {
    const written = await writeConcept(scenario.admin, doorsOf(scenario), writeOf(at, head));
    if (!written.ok) throw new Error(`the map did not land: ${String(written.error)}`);
    head = written.value.sha;
  }
  return scenario;
};

type WideMap = {
  readonly scenario: Scenario;
  readonly entries: readonly ConceptIri[];
  readonly lone: ConceptIri;
};

const nodeAt = (uids: readonly string[], at: number): string => {
  const uid = uids[at % uids.length];
  if (uid === undefined) throw new Error("the wide map holds no node there");
  return uid;
};

const seedWideMap = async (scenario: Scenario): Promise<WideMap> => {
  const workspaceId = scenario.workspaceId;
  const seeded = await seedingWith(db().pool, async (seed) => {
    const uids: string[] = [];
    const commitSha = (await seed.bundleCommit({ workspaceId })).sha;
    for (let at = 0; at < WIDE_NODES; at += 1) {
      const { iri } = await seed.conceptIdentity({ workspaceId });
      const path = `knowledge/${WIDE_COLLECTION}/node-${at}.md`;
      await seed.conceptIndex({ workspaceId, iri, commitSha, path });
      uids.push((await seed.mapNode({ workspaceId, uid: iri })).uid);
    }
    for (const [at, fromUid] of uids.entries()) {
      for (const step of WIDE_LINKS) {
        await seed.mapEdge({ workspaceId, fromUid, toUid: nodeAt(uids, at + step) });
      }
    }
    return { uids, lone: (await seed.mapNode({ workspaceId })).uid };
  });
  // Autovacuum counts a live map's rows; uncounted, the planner joins every node to every step.
  await db().pool.query("ANALYZE map_node, map_edge, concept_index");
  return {
    scenario,
    entries: seeded.uids
      .filter((_uid, at) => at % (WIDE_NODES / ENTRIES) === 0)
      .map((uid) => ids.conceptIri.parse(uid)),
    lone: ids.conceptIri.parse(seeded.lone),
  };
};

type TimedWalk = {
  readonly waitedMs: number;
  readonly oneRowMs: number;
  readonly oneRowSteps: number;
  readonly walkMs: number;
  readonly walkSteps: number;
};

const timedWalk = async (
  map: WideMap,
  reader: UserPrincipal,
  collections: readonly string[] | undefined,
): Promise<TimedWalk> => {
  const started = performance.now();
  const timed = answered(
    await readingAs(readers(), reader, async (principal, tx) => {
      const oneRowStarted = performance.now();
      const oneRow = await walkFrom(principal, tx, map.lone);
      const walkStarted = performance.now();
      const walk = await walkConceptsFromEntries(principal, tx, map.entries, collections);
      return {
        oneRowMs: walkStarted - oneRowStarted,
        oneRowSteps: oneRow.length,
        walkMs: performance.now() - walkStarted,
        walkSteps: walk.length,
      };
    }),
  );
  return { ...timed, waitedMs: performance.now() - started };
};

describe("the map under concurrent read load", () => {
  let dense: Scenario;
  let wide: WideMap;

  beforeAll(async () => {
    dense = await landDenseMap(await arrange());
    wide = await seedWideMap(await arrange());
  }, 300_000);

  it.each([
    ["a forty-entry walk", "", undefined],
    ["a narrowed walk", ", narrowed to its collection", [WIDE_COLLECTION]],
  ] as const)("answers %s within budget beside nine concurrent walks", async (...walked) => {
    const [, narrowing, collections] = walked;
    const walks: TimedWalk[] = [];
    for (let round = 0; round < ROUNDS; round += 1) {
      const inFlight = alternating(IN_FLIGHT, wide.scenario.viewer, wide.scenario.admin).map(
        (reader) => timedWalk(wide, reader, collections),
      );
      walks.push(...(await Promise.all(inFlight)));
    }
    const inOneRowWalks = percentile(
      walks.map((walk) => walk.walkMs / walk.oneRowMs),
      0.5,
    );
    const waitedMs = walks.map((walk) => walk.waitedMs);
    const walkMs = walks.map((walk) => walk.walkMs);

    const heading = `The map walk from forty entries under concurrent read load${narrowing}`;
    await recordFigures(heading, [
      [
        "the walk that fills the cap, in one-row walks at the median",
        `${inOneRowWalks.toFixed(1)}, against a budget of ${WALK_BUDGET_IN_ONE_ROW_WALKS}`,
      ],
      ["a caller's wait at the median", inMs(percentile(waitedMs, 0.5))],
      ["a caller's wait at p95", inMs(percentile(waitedMs, 0.95))],
      ["a caller's slowest wait", inMs(percentile(waitedMs, 1))],
      ["the walk statement at the median", inMs(percentile(walkMs, 0.5))],
      ["the walk statement at p95", inMs(percentile(walkMs, 0.95))],
      [
        "the slowest walk statement",
        `${inMs(percentile(walkMs, 1))}, against a timeout of ${inMs(WALK_TIMEOUT_MS)}`,
      ],
    ]);

    expect(readers().totalCount, "the connections the walks ran on").toBe(IN_FLIGHT);
    expect(wide.entries, "the entries each walk starts from").toHaveLength(40);
    expect(walks.map((walk) => [walk.oneRowSteps, walk.walkSteps])).toEqual(
      Array.from({ length: IN_FLIGHT * ROUNDS }, () => [1, CONCEPTS_UNDER_THE_CAP]),
    );
    expect(
      inOneRowWalks,
      "the walk that fills the cap, in one-row walks, at the median",
    ).toBeLessThan(WALK_BUDGET_IN_ONE_ROW_WALKS);
    expect(percentile(walkMs, 1), "the slowest walk statement, in milliseconds").toBeLessThan(
      WALK_TIMEOUT_MS,
    );
  });

  it("lands every concept and edge of the dense map", async () => {
    const rows = await db().pool.query<{ nodes: string; edges: string }>(
      `SELECT (SELECT count(*) FROM map_node WHERE workspace_id = $1) AS nodes,
              (SELECT count(*) FROM map_edge WHERE workspace_id = $1) AS edges`,
      [dense.workspaceId],
    );
    expect(rows.rows[0]).toEqual({ nodes: String(CONCEPTS), edges: String(EDGES) });
  });

  it("rebuilds the map in a real worker within two minutes", async () => {
    const workspaceId = dense.workspaceId;
    const queued = await enqueueJob(dense.admin, dense.postgres, {
      workspaceId,
      kind: "full-rebuild",

      reason: "drill",
    });
    assert(queued.ok, `the rebuild was not queued: ${inspect(queued)}`);

    const started = performance.now();
    await runWorkerOnce(db().connectionUri, bundles().root, "map-budget");
    const wallClockMs = performance.now() - started;

    const job = await db().pool.query<{ status: string }>(
      "SELECT status FROM job WHERE workspace_id = $1 AND id = $2",
      [workspaceId, queued.value.jobId],
    );
    expect(job.rows[0]?.status, "the rebuild's own row").toBe("done");
    expect(wallClockMs, "the worker's whole run, in milliseconds").toBeLessThan(REBUILD_BUDGET_MS);

    const rebuilt = await db().pool.query<{ live_gen: number; nodes: string; edges: string }>(
      `SELECT g.live_gen,
              (SELECT count(*) FROM map_node n
                WHERE n.workspace_id = $1 AND n.gen = g.live_gen) AS nodes,
              (SELECT count(*) FROM map_edge e
                WHERE e.workspace_id = $1 AND e.gen = g.live_gen) AS edges
         FROM map_generation g WHERE g.workspace_id = $1`,
      [workspaceId],
    );
    expect(rebuilt.rows[0]).toEqual({
      live_gen: 2,
      nodes: String(CONCEPTS),
      edges: String(EDGES),
    });
  });
});
