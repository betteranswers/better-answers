import { beforeAll, describe, expect, it } from "vitest";

import { GRAPH_WALK_ROW_LIMIT, walkFrom } from "@better-answers/core/store/graph";

import { writeConcept, type WriteConceptInput } from "../src/concepts/index.ts";
import type { UserPrincipal } from "../src/kernel/index.ts";
import { enqueueJob } from "../src/runs/index.ts";
import { readingAs } from "./suite-postgres.ts";
import { runWorkerOnce } from "./worker-process.ts";
import { doorsOf, suiteWithBundles, type Scenario } from "./workspace-with-bundle.ts";

const { db, bundles, arrange } = suiteWithBundles();

const CONCEPTS = 30;
const LINKS_EACH = 6;

const EDGES = 159;

const IN_FLIGHT = 20;
const ROUNDS = 5;

const WALK_P50_BUDGET_MS = 1_000;

const WALK_MAX_BUDGET_MS = 2_000;

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

type DenseMap = {
  readonly scenario: Scenario;
  readonly entry: string;
};

const landDenseMap = async (scenario: Scenario): Promise<DenseMap> => {
  let head: string | null = null;
  let entry = "";
  for (let at = 0; at < CONCEPTS; at += 1) {
    const written = await writeConcept(scenario.editor, doorsOf(scenario), writeOf(at, head));
    if (!written.ok) throw new Error(`the map did not land: ${String(written.error)}`);
    head = written.value.sha;
    entry = written.value.iri;
  }
  return { scenario, entry };
};

const timedWalk = async (
  map: DenseMap,
  reader: UserPrincipal,
): Promise<{ readonly ms: number; readonly steps: number }> => {
  const started = performance.now();
  const steps = await readingAs(db().runtimePool, reader, (principal, tx) =>
    walkFrom(principal, tx, map.entry),
  );
  return { ms: performance.now() - started, steps: steps.length };
};

const percentile = (sorted: readonly number[], fraction: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;

describe("the graph under concurrent read load", () => {
  let map: DenseMap;

  beforeAll(async () => {
    map = await landDenseMap(await arrange());
  }, 300_000);

  it("answers a walk of a dense map inside its budget while nineteen other walks are in flight", async () => {
    const durations: number[] = [];
    const answers: number[] = [];
    for (let round = 0; round < ROUNDS; round += 1) {
      const walks = Array.from({ length: IN_FLIGHT }, (_unused, at) =>
        timedWalk(map, at % 2 === 0 ? map.scenario.viewer : map.scenario.admin),
      );
      for (const walked of await Promise.all(walks)) {
        durations.push(walked.ms);
        answers.push(walked.steps);
      }
    }
    const sorted = durations.toSorted((a, b) => a - b);
    const p50 = percentile(sorted, 0.5);
    const worst = sorted.at(-1) ?? 0;

    expect(answers).toEqual(Array.from({ length: IN_FLIGHT * ROUNDS }, () => GRAPH_WALK_ROW_LIMIT));
    expect(p50, "the median walk, in milliseconds").toBeLessThan(WALK_P50_BUDGET_MS);
    expect(worst, "the slowest walk, in milliseconds").toBeLessThan(WALK_MAX_BUDGET_MS);
  });

  it("lands the dense map the two budgets are measured over, every concept and every edge", async () => {
    const rows = await db().pool.query<{ nodes: string; edges: string }>(
      `SELECT (SELECT count(*) FROM graph_node WHERE workspace_id = $1) AS nodes,
              (SELECT count(*) FROM graph_edge WHERE workspace_id = $1) AS edges`,
      [map.scenario.workspaceId],
    );
    expect(rows.rows[0]).toEqual({ nodes: String(CONCEPTS), edges: String(EDGES) });
  });

  it("rebuilds the whole map in the worker, as a real process, inside the two-minute promise", async () => {
    const workspaceId = map.scenario.workspaceId;
    const queued = await enqueueJob(map.scenario.admin, map.scenario.postgres, {
      workspaceId,
      kind: "full-rebuild",

      reason: "drill",
    });
    if (!queued.ok) throw new Error(`the rebuild was not queued: ${String(queued.error)}`);

    const started = performance.now();
    await runWorkerOnce(db().connectionUri, bundles().root, "graph-budget");
    const wallClockMs = performance.now() - started;

    const job = await db().pool.query<{ status: string }>(
      "SELECT status FROM job WHERE workspace_id = $1 AND id = $2",
      [workspaceId, queued.value.jobId],
    );
    expect(job.rows[0]?.status, "the rebuild's own row").toBe("done");
    expect(wallClockMs, "the worker's whole run, in milliseconds").toBeLessThan(REBUILD_BUDGET_MS);

    const rebuilt = await db().pool.query<{ live_gen: number; nodes: string; edges: string }>(
      `SELECT g.live_gen,
              (SELECT count(*) FROM graph_node n
                WHERE n.workspace_id = $1 AND n.gen = g.live_gen) AS nodes,
              (SELECT count(*) FROM graph_edge e
                WHERE e.workspace_id = $1 AND e.gen = g.live_gen) AS edges
         FROM graph_generation g WHERE g.workspace_id = $1`,
      [workspaceId],
    );
    expect(rebuilt.rows[0]).toEqual({
      live_gen: 2,
      nodes: String(CONCEPTS),
      edges: String(EDGES),
    });
  });
});
