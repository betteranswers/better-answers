import { appendFile } from "node:fs/promises";

import { beforeAll, describe, expect, it } from "vitest";

import { GRAPH_WALK_ROW_LIMIT, walkFrom } from "@better-answers/core/store/graph";

import { writeConcept, type WriteConceptInput } from "../src/concepts/index.ts";
import type { UserPrincipal } from "../src/kernel/index.ts";
import { enqueueJob } from "../src/runs/index.ts";
import { answered, readingAs } from "./suite-postgres.ts";
import { runWorkerOnce } from "./worker-process.ts";
import { doorsOf, suiteWithBundles, type Scenario } from "./workspace-with-bundle.ts";

const { db, bundles, arrange } = suiteWithBundles();

const CONCEPTS = 30;
const LINKS_EACH = 6;

const EDGES = 159;

const IN_FLIGHT = 20;
const ROUNDS = 5;

// Priced against a one-row walk on the same connection before it: load slows both alike, a
// dearer walk only the one filling the cap.
const WALK_BUDGET_IN_ONE_ROW_WALKS = 200;

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
  readonly leaf: string;
};

const landDenseMap = async (scenario: Scenario): Promise<DenseMap> => {
  let head: string | null = null;
  let entry = "";
  let leaf = "";
  for (let at = 0; at < CONCEPTS; at += 1) {
    const written = await writeConcept(scenario.editor, doorsOf(scenario), writeOf(at, head));
    if (!written.ok) throw new Error(`the map did not land: ${String(written.error)}`);
    head = written.value.sha;
    entry = written.value.iri;
    if (at === 0) leaf = written.value.iri;
  }
  return { scenario, entry, leaf };
};

type TimedWalk = {
  readonly waitedMs: number;
  readonly oneRowMs: number;
  readonly oneRowSteps: number;
  readonly walkMs: number;
  readonly walkSteps: number;
};

const timedWalk = async (map: DenseMap, reader: UserPrincipal): Promise<TimedWalk> => {
  const started = performance.now();
  const timed = answered(
    await readingAs(db().runtimePool, reader, async (principal, tx) => {
      const oneRowStarted = performance.now();
      const oneRow = await walkFrom(principal, tx, map.leaf);
      const walkStarted = performance.now();
      const walk = await walkFrom(principal, tx, map.entry);
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

const percentile = (values: readonly number[], fraction: number): number => {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
};

const inMs = (value: number): string => `${Math.round(value)} ms`;

type Figure = readonly [name: string, value: string];

const recordFigures = async (figures: readonly Figure[]): Promise<void> => {
  const heading = "The graph walk under concurrent read load";
  process.stdout.write(
    `\n${heading}: ${figures.map(([name, value]) => `${name} ${value}`).join("; ")}\n`,
  );
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary === undefined) return;
  const rows = figures.map(([name, value]) => `| ${name} | ${value} |`);
  await appendFile(
    summary,
    ["", `#### ${heading}`, "", "| Figure | Value |", "| --- | --- |", ...rows, ""].join("\n"),
  );
};

describe("the graph under concurrent read load", () => {
  let map: DenseMap;

  beforeAll(async () => {
    map = await landDenseMap(await arrange());
  }, 300_000);

  it("answers a walk that fills the row cap for under two hundred one-row walks at the median while nineteen other walks are in flight", async () => {
    const walks: TimedWalk[] = [];
    for (let round = 0; round < ROUNDS; round += 1) {
      const inFlight = Array.from({ length: IN_FLIGHT }, (_unused, at) =>
        timedWalk(map, at % 2 === 0 ? map.scenario.viewer : map.scenario.admin),
      );
      walks.push(...(await Promise.all(inFlight)));
    }
    const inOneRowWalks = percentile(
      walks.map((walked) => walked.walkMs / walked.oneRowMs),
      0.5,
    );
    const waitedMs = walks.map((walked) => walked.waitedMs);
    const walkMs = walks.map((walked) => walked.walkMs);

    await recordFigures([
      [
        "the walk that fills the cap, in one-row walks at the median",
        `${inOneRowWalks.toFixed(1)}, against a budget of ${WALK_BUDGET_IN_ONE_ROW_WALKS}`,
      ],
      ["a caller's wait at the median", inMs(percentile(waitedMs, 0.5))],
      ["a caller's wait at p95", inMs(percentile(waitedMs, 0.95))],
      ["a caller's slowest wait", inMs(percentile(waitedMs, 1))],
      ["the slowest walk statement", inMs(percentile(walkMs, 1))],
    ]);

    expect(walks.map((walked) => [walked.oneRowSteps, walked.walkSteps])).toEqual(
      Array.from({ length: IN_FLIGHT * ROUNDS }, () => [1, GRAPH_WALK_ROW_LIMIT]),
    );
    expect(
      inOneRowWalks,
      "the walk that fills the cap, in one-row walks, at the median",
    ).toBeLessThan(WALK_BUDGET_IN_ONE_ROW_WALKS);
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

    // The whole hop's wall clock, boot included: over-counting is the safe direction for a
    // promise.
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
