import { testData, type TestData } from "@better-answers/schema/testing";
import { describe, expect, it } from "vitest";

import { GRAPH_MAINTENANCE, graphCounts, sweepGraph } from "@better-answers/core/concepts";

import { provisionedWorkspace, type ProvisionedWorkspace } from "./platform.ts";
import { postgresForSuite } from "./suite-postgres.ts";

/**
 * The two graph maintenance acts the restore drill calls — the per-label count of the map
 * a read can reach, and the sweep of everything a finished rebuild left behind — through
 * the concepts slice's interface (`[TEST1]`), on real Postgres.
 *
 * Both run under the graph maintenance principal and never a person's: the drill has no
 * session behind it. The count writes no ledger row, because a read is not an act
 * (`[AUDIT8]`); the sweep writes one row per generation it removed, in the transaction
 * that removed it (`[AUDIT1]`).
 */

const db = postgresForSuite();

const seeded = async <T>(work: (seed: TestData) => Promise<T>): Promise<T> => {
  const client = await db().pool.connect();
  try {
    return await work(testData(client));
  } finally {
    client.release();
  }
};

const arrange = (): Promise<ProvisionedWorkspace> => provisionedWorkspace(db(), "Mapped");

/** The rows one generation of a workspace's map still holds, read past the policy. */
const rowsOf = async (workspaceId: string, gen: number | null): Promise<[number, number]> => {
  const clause = gen === null ? "gen IS NULL" : "gen = $2";
  const parameters = gen === null ? [workspaceId] : [workspaceId, gen];
  const nodes = await db().pool.query(
    `SELECT 1 FROM graph_node WHERE workspace_id = $1 AND ${clause}`,
    parameters,
  );
  const edges = await db().pool.query(
    `SELECT 1 FROM graph_edge WHERE workspace_id = $1 AND ${clause}`,
    parameters,
  );
  return [nodes.rowCount ?? 0, edges.rowCount ?? 0];
};

/** Every `platform.graph.swept` row of a workspace, read as the superuser. */
const sweptEvents = async (
  workspaceId: string,
): Promise<readonly { subject_id: string; detail: unknown; batch_id: string | null }[]> => {
  const found = await db().pool.query<{
    subject_id: string;
    detail: unknown;
    batch_id: string | null;
  }>(
    `SELECT subject_id, detail, batch_id FROM audit_event
      WHERE workspace_id = $1 AND act = 'platform.graph.swept' ORDER BY subject_id`,
    [workspaceId],
  );
  return found.rows;
};

/**
 * A map of two generations and a source entity: the live one, a rebuild's leftovers beside
 * it, and the partition that carries no generation at all. What every test here starts from.
 */
const mapWithLeftovers = async (workspace: ProvisionedWorkspace): Promise<void> => {
  const workspaceId = workspace.workspaceId;
  await seeded(async (seed) => {
    const live = await seed.graphNode({ workspaceId });
    await seed.graphEdge({ workspaceId, fromUid: live.uid });
    const person = await seed.graphNode({
      workspaceId,
      gen: null,
      label: "source-entity:Person",
      kind: null,
    });
    await seed.graphEdge({
      workspaceId,
      gen: null,
      label: "IS_CONCEPT",
      fromUid: person.uid,
      toUid: live.uid,
      uid: `is_concept:${person.uid}`,
    });
    const left = await seed.graphNode({ workspaceId, gen: 2 });
    await seed.graphEdge({ workspaceId, gen: 2, fromUid: left.uid });
  });
};

describe("counting a workspace's map", () => {
  it("reports the live generation and the source entities beside it, per label, and never a rebuild's leftovers", async () => {
    const workspace = await arrange();
    await mapWithLeftovers(workspace);

    const counted = await graphCounts(GRAPH_MAINTENANCE, workspace.door, {
      workspaceId: workspace.workspaceId,
    });

    // Generation 2 holds a node and an edge of its own and appears nowhere: the counts are
    // exactly the set a walk binds — the live generation, and the partition with no
    // generation, which is reconciled per document and walks beside it (ADR 0023).
    expect(counted).toEqual({
      ok: true,
      value: {
        liveGen: 1,
        nodes: { Concept: 2, "source-entity:Person": 1 },
        edges: { IS_CONCEPT: 1, LINKS_TO: 1 },
      },
    });
  });

  it("answers a workspace nobody has mapped with zeroes, so a restore over an empty map is done and not a failure", async () => {
    const workspace = await arrange();

    const counted = await graphCounts(GRAPH_MAINTENANCE, workspace.door, {
      workspaceId: workspace.workspaceId,
    });

    expect(counted).toEqual({ ok: true, value: { liveGen: null, nodes: {}, edges: {} } });
  });

  it("counts one workspace's map and never a neighbour's", async () => {
    const ours = await arrange();
    const theirs = await arrange();
    await mapWithLeftovers(theirs);

    const counted = await graphCounts(GRAPH_MAINTENANCE, ours.door, {
      workspaceId: ours.workspaceId,
    });

    expect(counted).toEqual({ ok: true, value: { liveGen: null, nodes: {}, edges: {} } });
  });

  it("says a workspace that is not an id is malformed, before it reads anything", async () => {
    const workspace = await arrange();

    const counted = await graphCounts(GRAPH_MAINTENANCE, workspace.door, {
      workspaceId: "ws_synthetic",
    });

    expect(counted).toEqual({ ok: false, error: "malformed" });
  });

  it("writes no ledger row, because a count is a read", async () => {
    const workspace = await arrange();
    await mapWithLeftovers(workspace);

    await graphCounts(GRAPH_MAINTENANCE, workspace.door, {
      workspaceId: workspace.workspaceId,
    });

    expect(await sweptEvents(workspace.workspaceId)).toEqual([]);
  });
});

describe("sweeping a workspace's map", () => {
  it("removes every generation but the live one, and leaves the live one and the source entities exactly as they were", async () => {
    const workspace = await arrange();
    await mapWithLeftovers(workspace);

    const swept = await sweepGraph(GRAPH_MAINTENANCE, workspace.door, {
      workspaceId: workspace.workspaceId,
    });

    expect(swept).toEqual({ ok: true, value: [{ gen: 2, nodes: 2, edges: 1 }] });
    expect(await rowsOf(workspace.workspaceId, 1)).toEqual([2, 1]);
    expect(await rowsOf(workspace.workspaceId, null)).toEqual([1, 1]);
    expect(await rowsOf(workspace.workspaceId, 2)).toEqual([0, 0]);
  });

  it("writes one ledger row per generation removed, sharing a batch id, with the counts it removed", async () => {
    const workspace = await arrange();
    await mapWithLeftovers(workspace);
    await seeded(async (seed) => {
      const third = await seed.graphNode({ workspaceId: workspace.workspaceId, gen: 3 });
      await seed.graphEdge({ workspaceId: workspace.workspaceId, gen: 3, fromUid: third.uid });
    });

    const swept = await sweepGraph(GRAPH_MAINTENANCE, workspace.door, {
      workspaceId: workspace.workspaceId,
    });

    expect(swept).toEqual({
      ok: true,
      value: [
        { gen: 2, nodes: 2, edges: 1 },
        { gen: 3, nodes: 2, edges: 1 },
      ],
    });
    const events = await sweptEvents(workspace.workspaceId);
    expect(events.map((event) => event.subject_id)).toEqual(["2", "3"]);
    expect(events.map((event) => event.detail)).toEqual([
      { generation: 2, nodes: 2, edges: 1 },
      { generation: 3, nodes: 2, edges: 1 },
    ]);
    // A bulk act is N rows sharing one batch id, never one row hiding N (`[AUDIT1]`).
    const batches = new Set(events.map((event) => event.batch_id));
    expect(batches.size).toBe(1);
    expect([...batches][0]).not.toBeNull();
  });

  it("has nothing to sweep in a workspace whose map is only the live generation, and writes no row for it", async () => {
    const workspace = await arrange();
    await seeded((seed) => seed.graphNode({ workspaceId: workspace.workspaceId }));

    const swept = await sweepGraph(GRAPH_MAINTENANCE, workspace.door, {
      workspaceId: workspace.workspaceId,
    });

    expect(swept).toEqual({ ok: true, value: [] });
    expect(await rowsOf(workspace.workspaceId, 1)).toEqual([1, 0]);
    expect(await sweptEvents(workspace.workspaceId)).toEqual([]);
  });

  it("has nothing to sweep in a workspace with no generation row, and touches no row it cannot say is not live", async () => {
    const workspace = await arrange();
    // Rows with a generation and no `graph_generation` row to say which one is live: a
    // restore that carried the map without its one-row pointer. Which generation is live
    // is unknown, so a sweep that guessed would delete the map.
    await seeded((seed) => seed.graphNode({ workspaceId: workspace.workspaceId, gen: 7 }));
    await db().pool.query("DELETE FROM graph_generation WHERE workspace_id = $1", [
      workspace.workspaceId,
    ]);

    const swept = await sweepGraph(GRAPH_MAINTENANCE, workspace.door, {
      workspaceId: workspace.workspaceId,
    });

    expect(swept).toEqual({ ok: true, value: [] });
    expect(await rowsOf(workspace.workspaceId, 7)).toEqual([1, 0]);
  });

  it("sweeps one workspace's leftovers and never a neighbour's", async () => {
    const ours = await arrange();
    const theirs = await arrange();
    await mapWithLeftovers(ours);
    await mapWithLeftovers(theirs);

    const swept = await sweepGraph(GRAPH_MAINTENANCE, ours.door, {
      workspaceId: ours.workspaceId,
    });

    expect(swept).toEqual({ ok: true, value: [{ gen: 2, nodes: 2, edges: 1 }] });
    expect(await rowsOf(theirs.workspaceId, 2)).toEqual([2, 1]);
  });

  it("says a workspace that is not an id is malformed, before it deletes anything", async () => {
    const workspace = await arrange();

    const swept = await sweepGraph(GRAPH_MAINTENANCE, workspace.door, {
      workspaceId: "ws_synthetic",
    });

    expect(swept).toEqual({ ok: false, error: "malformed" });
  });
});

describe("a sweep whose ledger row cannot be written", () => {
  // `[AUDIT1]` and `[TEST8]`: the rows a sweep removes and the rows it books land or fail
  // together. The provocation is the ledger itself refusing the app's role, which is what
  // an act whose event cannot be written looks like from inside the transaction; the
  // assertion is on the transaction's outcome first, then on the rows.
  it("removes no generation at all", async () => {
    const workspace = await arrange();
    await mapWithLeftovers(workspace);
    await db().pool.query("REVOKE INSERT ON audit_event FROM app_rt");
    try {
      const swept = await sweepGraph(GRAPH_MAINTENANCE, workspace.door, {
        workspaceId: workspace.workspaceId,
      });

      expect(swept.ok).toBe(false);
      expect(await rowsOf(workspace.workspaceId, 2)).toEqual([2, 1]);
      expect(await rowsOf(workspace.workspaceId, 1)).toEqual([2, 1]);
    } finally {
      await db().pool.query("GRANT INSERT ON audit_event TO app_rt");
    }
  });
});
