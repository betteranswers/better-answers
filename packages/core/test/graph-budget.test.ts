import { beforeAll, describe, expect, it } from "vitest";

import { GRAPH_WALK_ROW_LIMIT, walkFrom } from "@better-answers/core/store/graph";

import { writeConcept, type WriteConceptInput } from "../src/concepts/index.ts";
import type { UserPrincipal } from "../src/kernel/index.ts";
import { readingAs } from "./suite-postgres.ts";
import { doorsOf, suiteWithBundles, type Scenario } from "./workspace-with-bundle.ts";

/**
 * **The measured budgets** (T-006 spec, *Ops and the budget*; T-058). Two costs the estate
 * promises and this file turns into facts: what a traversal costs while the box is busy
 * answering other traversals, and what landing a whole map costs. Ordinary members of the
 * suite — no skip, no `it.concurrent`, nothing that would let a budget fail unnoticed.
 *
 * **Where the numbers came from.** Derived by running this file on **8 September 2026** on
 * an Apple M4 Pro (14 cores, 24 GB) against the run's warm Testcontainers Postgres. CI runs
 * it on GitHub's `ubuntu-latest` standard runner — 4 vCPU, 16 GB, with the database in the
 * same VM — and the estate is a 4 GB box, so every budget below is the measurement times a
 * stated headroom rather than the measurement.
 *
 * **The headroom is 8× rather than the 3× that was first proposed, and the reason is
 * measured too.** The same file, run on the same machine while a browser and a second
 * container stack had it busy, answered a p50 of 318 ms against a quiet 127 ms and landed
 * its map five times slower per write. A budget test that is flaky is worse than none, and
 * the thing that moves a budget test is the machine, not the code — so each number below
 * clears the busy measurement as well as the quiet one, and a breach means the cost really
 * moved.
 */

const { db, arrange } = suiteWithBundles();

/**
 * The map: thirty concepts, each linking to the six written before it. Dense enough that the
 * walk's row cap is the thing under measurement — a walk from the last concept reaches
 * 1,555 rows within four hops (the entry, then 6, 36, 216 and 1,296) and
 * `GRAPH_WALK_ROW_LIMIT` returns 1,000 of them, cutting 555 — and small enough that landing
 * it through the governed write is a suite's arrange and not its day. Thirty is the first
 * round number past the twenty-five at which every one of the 1,296 four-hop paths exists:
 * six hops back four times is twenty-four, so an entry at index twenty-nine never runs out
 * of concepts to reach.
 */
const CONCEPTS = 30;
const LINKS_EACH = 6;
/** Six from each concept but the first six, which have fewer written before them to link to. */
const EDGES = 159;

/** The load: twenty walks in flight at once, five rounds of them, over the app's own pool. */
const IN_FLIGHT = 20;
const ROUNDS = 5;

/**
 * **Traversal, p50: 1,000 ms.** Measured 127 ms over 100 walks quiet, 318 ms busy; the
 * budget is 8× the quiet measurement, which is also 3× the busy one.
 *
 * The span measured is the whole of what a caller waits — a connection out of the five the
 * app's pool holds, the Principal resolved inside it, then the walk — so twenty walks in
 * flight means most of these spans include queueing behind four other readers. That is the
 * number a reader on a busy box actually experiences, which is why it is the one budgeted
 * rather than the statement's own time; the pool's depth is a term of it, and a change to
 * that depth moves this measurement without the traversal costing a thing more.
 */
const WALK_P50_BUDGET_MS = 1_000;

/**
 * **Traversal, worst case: 2,000 ms.** Measured 216 ms quiet, 358 ms busy. The slowest of a
 * hundred walks is the one measurement that swings — a cold cache, a checkpoint, a runner
 * that lost its core to something else — so its headroom is the larger, and a budget that
 * failed on that would fail for the wrong reason.
 */
const WALK_MAX_BUDGET_MS = 2_000;

/**
 * **Landing the whole map: 150 s**, over a map of thirty concepts. Measured 25.2 s — and
 * **840 ms per governed write**, which is the number that carries: the same measurement at
 * ten, thirty and sixty concepts gives 833, 840 and 872 ms per write, so the cost is linear
 * in concepts and ADR 0032's two minutes buys about 140 concepts through this path on this
 * machine. The budget is 6× the measurement, because the same thirty writes took five times
 * as long each on a machine that was busy.
 *
 * **This is not the rebuild, and the rebuild half of the criterion waits on the worker.**
 * ADR 0032 promises a full rebuild of a workspace's map in ≤2 minutes; the rebuild is the
 * worker's (T-057), it reads the bundle once and writes a whole generation without a commit
 * per concept, and `packages/core/test/rebuild-equivalence.test.ts` is where it runs as a
 * real process. What is measured here is the other cost over the same map — landing it act
 * by act through the governed write, each act a commit to the bare repository and one
 * transaction carrying the index row, the ledger row and the graph delta. It is a heavier
 * shape than the rebuild and an upper bound on nothing the rebuild does, so it is stated as
 * the app-side cost it is rather than reported as the rebuild's. When the worker's rebuild
 * lands, its own measurement re-derives the promise and this comment says so.
 */
const MAP_LANDED_BUDGET_MS = 150_000;

/** The body of concept `at`: a link to each of the six concepts written before it. */
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
  // Published, Internal and open to everyone, so every element of every path is one both
  // readers may see: what is measured here is the traversal, never the predicate's refusals.
  status: "stable",
  sensitivity: "Internal",
});

/** The map, the concept every walk enters at, and what landing the whole of it cost. */
type DenseMap = {
  readonly scenario: Scenario;
  readonly entry: string;
  readonly landedMs: number;
};

const landDenseMap = async (scenario: Scenario): Promise<DenseMap> => {
  const started = performance.now();
  let head: string | null = null;
  let entry = "";
  for (let at = 0; at < CONCEPTS; at += 1) {
    const written = await writeConcept(scenario.editor, doorsOf(scenario), writeOf(at, head));
    if (!written.ok) throw new Error(`the map did not land: ${String(written.error)}`);
    head = written.value.sha;
    entry = written.value.iri;
  }
  return { scenario, entry, landedMs: performance.now() - started };
};

/** One walk, timed the way a caller experiences it: the connection, the resolve, the walk. */
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
      // A Viewer and an Admin alternating, so both arms of the read predicate are under the
      // load and not only the cheaper one.
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

    // Every walk answered exactly the cap, which is what makes this a measurement of the
    // budgeted case rather than of a small map: the map holds more paths within four hops
    // than the template will return, so the cost measured is the cost of filling the cap.
    expect(answers).toEqual(Array.from({ length: IN_FLIGHT * ROUNDS }, () => GRAPH_WALK_ROW_LIMIT));
    expect(p50, "the median walk, in milliseconds").toBeLessThan(WALK_P50_BUDGET_MS);
    expect(worst, "the slowest walk, in milliseconds").toBeLessThan(WALK_MAX_BUDGET_MS);
  });

  it("lands a thirty-concept map, its commits and its whole delta inside the write path's budget", async () => {
    expect(map.landedMs, "the whole map landed, in milliseconds").toBeLessThan(
      MAP_LANDED_BUDGET_MS,
    );
    // The map is really there, and it is the dense one: thirty concepts, and the 159 edges
    // the six-link rule derives — six from each concept but the first six, which have
    // fewer written before them to link to.
    const rows = await db().pool.query<{ nodes: string; edges: string }>(
      `SELECT (SELECT count(*) FROM graph_node WHERE workspace_id = $1) AS nodes,
              (SELECT count(*) FROM graph_edge WHERE workspace_id = $1) AS edges`,
      [map.scenario.workspaceId],
    );
    expect(rows.rows[0]).toEqual({ nodes: String(CONCEPTS), edges: String(EDGES) });
  });
});
