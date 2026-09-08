import { beforeAll, describe, expect, it } from "vitest";

import { GRAPH_WALK_ROW_LIMIT, walkFrom } from "@better-answers/core/store/graph";

import { writeConcept, type WriteConceptInput } from "../src/concepts/index.ts";
import type { UserPrincipal } from "../src/kernel/index.ts";
import { enqueueJob } from "../src/runs/index.ts";
import { readingAs } from "./suite-postgres.ts";
import { runWorkerOnce } from "./worker-process.ts";
import { doorsOf, suiteWithBundles, type Scenario } from "./workspace-with-bundle.ts";

/**
 * **The measured budgets** (T-006 spec, *Ops and the budget*; T-058). Three costs the estate
 * promises and this file turns into facts, over one dense map: what a traversal costs while
 * the box is busy answering other traversals, what landing the map act by act costs, and
 * what the worker's full rebuild of it costs as a real process. Ordinary members of the
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

const { db, bundles, arrange } = suiteWithBundles();

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
 * **Landing a concept: 8,000 ms each.** Measured **840–856 ms per governed write**, and linear
 * in concepts — the same measurement at ten, thirty and sixty gives 833, 840 and 872 ms —
 * so ADR 0032's two minutes buys about 140 concepts through this path on this machine.
 *
 * The ceiling is a round 9× the measurement, and that is deliberately loose, because a
 * wall-clock budget over twenty-five seconds of work is a measurement of the machine before
 * it is a measurement of the code: the same thirty writes took five times as long each on a
 * developer's machine running a second agent's suite, and an earlier 150 s total budget
 * failed there while passing everywhere else. What this ceiling catches is a write path that
 * has become an order of magnitude dearer. What catches a regression in *shape* is the
 * second assertion below, which no machine can move.
 */
const PER_WRITE_BUDGET_MS = 8_000;

/**
 * **The cost per write does not grow with the size of the map.** The second half of the map
 * is landed onto a bundle and an index that already hold the first half, so if any part of
 * the write path were quadratic — the linker re-derive scanning every row, an index that
 * stopped being used — the later writes would cost visibly more than the earlier ones. At
 * thirty concepts a quadratic path would put the halves about 3× apart; the measurement is
 * 0.88× — the later half is fractionally the cheaper, on warm caches — and 2.5 is the line
 * between them.
 *
 * This is the assertion that carries, because it is a ratio of two measurements taken on the
 * same machine seconds apart: a slow box slows both halves and moves it not at all.
 */
const LINEARITY_FACTOR = 2.5;

/**
 * **Neither number above is the rebuild.** They are the app's write path — a git commit and
 * one transaction per concept — which is a much heavier shape than the rebuild, and an upper
 * bound on nothing the rebuild does. They are budgeted apart, and neither is ever quoted as
 * the other.
 *
 * **The rebuild: 120,000 ms**, which is ADR 0032's two-minute per-workspace promise held
 * against the real thing rather than assumed (T-007 is void). The rebuild is the worker's: a
 * real process, `uv run --frozen better-answers-worker --once`, claiming the job this test
 * queues and reading the bundle once to write a whole generation. Measured **467 ms** for
 * this thirty-concept map, and that is the whole hop — `uv run`, the interpreter, the claim,
 * the rebuild and the finish — because the job's row cannot say how long the rebuild itself
 * took: `claimed_at` and `finished_at` are both `now()`, the transaction's start, and the
 * worker's claim, work and finish share one transaction, so a finished row carries the same
 * instant in both columns.
 *
 * The budget is the promise itself rather than a multiple of the measurement, because the
 * promise is the number the estate made and the one an operator will hold it to; the room
 * between them — two hundred and fifty-fold at this size, on an over-counted span — is what
 * says the promise holds for a map far larger than this one.
 */
const REBUILD_BUDGET_MS = 120_000;

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

/**
 * The map, the concept every walk enters at, and what landing it cost — per write, and per
 * write in each half of the map, which is what says the cost does not grow with the map.
 */
type DenseMap = {
  readonly scenario: Scenario;
  readonly entry: string;
  readonly perWriteMs: number;
  readonly firstHalfPerWriteMs: number;
  readonly secondHalfPerWriteMs: number;
};

const landDenseMap = async (scenario: Scenario): Promise<DenseMap> => {
  const started = performance.now();
  const half = CONCEPTS / 2;
  let halfway = started;
  let head: string | null = null;
  let entry = "";
  for (let at = 0; at < CONCEPTS; at += 1) {
    const written = await writeConcept(scenario.editor, doorsOf(scenario), writeOf(at, head));
    if (!written.ok) throw new Error(`the map did not land: ${String(written.error)}`);
    head = written.value.sha;
    entry = written.value.iri;
    if (at === half - 1) halfway = performance.now();
  }
  const finished = performance.now();
  return {
    scenario,
    entry,
    perWriteMs: (finished - started) / CONCEPTS,
    firstHalfPerWriteMs: (halfway - started) / half,
    secondHalfPerWriteMs: (finished - halfway) / half,
  };
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

  it("lands each concept, its commit and its whole delta at a cost the size of the map does not move", async () => {
    expect(map.perWriteMs, "one governed write, in milliseconds").toBeLessThan(PER_WRITE_BUDGET_MS);
    // The shape, not the speed: the halves are two measurements of the same machine seconds
    // apart, so a slow box moves both and this ratio not at all.
    expect(
      map.secondHalfPerWriteMs / map.firstHalfPerWriteMs,
      "the later half of the map, per write, against the earlier half",
    ).toBeLessThan(LINEARITY_FACTOR);
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

  it("rebuilds the whole map in the worker, as a real process, inside the two-minute promise", async () => {
    const workspaceId = map.scenario.workspaceId;
    const queued = await enqueueJob(map.scenario.admin, map.scenario.postgres, {
      workspaceId,
      kind: "full-rebuild",
      // The reason the promise is about: the restore drill's rebuild is what ADR 0032's
      // two minutes were written for, and `pnpm ops graph-rebuild` defaults to this word.
      reason: "drill",
    });
    if (!queued.ok) throw new Error(`the rebuild was not queued: ${String(queued.error)}`);

    const started = performance.now();
    await runWorkerOnce(db().connectionUri, bundles().root, "graph-budget");
    const wallClockMs = performance.now() - started;

    // The budgeted span is the wall clock of the whole hop — `uv run`, a Python
    // interpreter starting, the claim, the rebuild and the finish — which over-counts the
    // rebuild by everything the estate's long-running worker pays once at boot and never
    // per job. Over-counting is the safe direction for a promise, so it is what is held.
    //
    // The job's own row cannot supply the number: `claimed_at` and `finished_at` are both
    // `now()`, which is the transaction's start, and the worker's claim, work and finish
    // share one Postgres transaction — so a finished row carries the same instant in both
    // columns and reads as a rebuild that took no time at all.
    const job = await db().pool.query<{ status: string }>(
      "SELECT status FROM job WHERE workspace_id = $1 AND id = $2",
      [workspaceId, queued.value.jobId],
    );
    expect(job.rows[0]?.status, "the rebuild's own row").toBe("done");
    expect(wallClockMs, "the worker's whole run, in milliseconds").toBeLessThan(REBUILD_BUDGET_MS);

    // A rebuild that produced an empty generation would pass a timing budget beautifully,
    // so the map it made is counted: the same thirty concepts and 159 edges, in the
    // generation the flip made live.
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
