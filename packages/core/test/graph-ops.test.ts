import { describe, expect, it } from "vitest";

import {
  GRAPH_MAINTENANCE,
  graphCounts,
  rebuildGraph,
  sweepGraph,
} from "@better-answers/core/concepts";
import type { TestData } from "@better-answers/schema/testing";

import { provisionedWorkspace, type ProvisionedWorkspace } from "./platform.ts";
import { postgresForSuite, seedingWith } from "./suite-postgres.ts";

const db = postgresForSuite();

const seeded = <T>(work: (seed: TestData) => Promise<T>): Promise<T> =>
  seedingWith(db().pool, work);

const arrange = (): Promise<ProvisionedWorkspace> => provisionedWorkspace(db(), "Mapped");

const counting = (workspace: ProvisionedWorkspace, workspaceId: string = workspace.workspaceId) =>
  graphCounts(GRAPH_MAINTENANCE, workspace.door, { workspaceId });

const sweeping = (workspace: ProvisionedWorkspace, workspaceId: string = workspace.workspaceId) =>
  sweepGraph(GRAPH_MAINTENANCE, workspace.door, { workspaceId });

const rebuilding = (workspace: ProvisionedWorkspace, workspaceId: string = workspace.workspaceId) =>
  rebuildGraph(GRAPH_MAINTENANCE, workspace.door, { workspaceId, reason: "upgrade" });

const jobsOf = async (workspaceId: string) => {
  const found = await db().pool.query<{
    id: string;
    kind: string;
    reason: string | null;
    status: string;
  }>("SELECT id, kind, reason, status FROM job WHERE workspace_id = $1", [workspaceId]);
  return found.rows;
};

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
  it("counts the live generation and source entities, never rebuild leftovers", async () => {
    const workspace = await arrange();
    await mapWithLeftovers(workspace);

    const counted = await counting(workspace);

    expect(counted).toEqual({
      ok: true,
      value: {
        liveGen: 1,
        nodes: { Concept: 2, "source-entity:Person": 1 },
        edges: { IS_CONCEPT: 1, LINKS_TO: 1 },
      },
    });
  });

  it("counts an unmapped workspace as empty, not a failure", async () => {
    const workspace = await arrange();

    const counted = await counting(workspace);

    expect(counted).toEqual({ ok: true, value: { liveGen: null, nodes: {}, edges: {} } });
  });

  it("counts one workspace's map and never a neighbour's", async () => {
    const ours = await arrange();
    const theirs = await arrange();
    await mapWithLeftovers(theirs);

    const counted = await counting(ours);

    expect(counted).toEqual({ ok: true, value: { liveGen: null, nodes: {}, edges: {} } });
  });

  it("says a workspace that is not an id is malformed", async () => {
    const workspace = await arrange();

    const counted = await counting(workspace, "ws_synthetic");

    expect(counted).toEqual({ ok: false, error: "malformed" });
  });

  it("writes no audit event, because a count is a read", async () => {
    const workspace = await arrange();
    await mapWithLeftovers(workspace);

    await counting(workspace);

    expect(await sweptEvents(workspace.workspaceId)).toEqual([]);
  });
});

describe("sweeping a workspace's map", () => {
  it("removes every generation but the live one, keeping source entities", async () => {
    const workspace = await arrange();
    await mapWithLeftovers(workspace);

    const swept = await sweeping(workspace);

    expect(swept).toEqual({ ok: true, value: [{ gen: 2, nodes: 2, edges: 1 }] });
    expect(await rowsOf(workspace.workspaceId, 1)).toEqual([2, 1]);
    expect(await rowsOf(workspace.workspaceId, null)).toEqual([1, 1]);
    expect(await rowsOf(workspace.workspaceId, 2)).toEqual([0, 0]);
  });

  it("writes one audit event per removed generation, under one batch", async () => {
    const workspace = await arrange();
    await mapWithLeftovers(workspace);

    await seeded(async (seed) => {
      await db().pool.query("UPDATE graph_generation SET live_gen = 2 WHERE workspace_id = $1", [
        workspace.workspaceId,
      ]);
      const third = await seed.graphNode({ workspaceId: workspace.workspaceId, gen: 3 });
      await seed.graphEdge({ workspaceId: workspace.workspaceId, gen: 3, fromUid: third.uid });
      await db().pool.query("UPDATE graph_generation SET live_gen = 3 WHERE workspace_id = $1", [
        workspace.workspaceId,
      ]);
    });

    const swept = await sweeping(workspace);

    expect(swept).toEqual({
      ok: true,
      value: [
        { gen: 1, nodes: 2, edges: 1 },
        { gen: 2, nodes: 2, edges: 1 },
      ],
    });
    const events = await sweptEvents(workspace.workspaceId);
    expect(events.map((event) => event.subject_id)).toEqual(["1", "2"]);
    expect(events.map((event) => event.detail)).toEqual([
      { generation: 1, nodes: 2, edges: 1 },
      { generation: 2, nodes: 2, edges: 1 },
    ]);

    const batches = new Set(events.map((event) => event.batch_id));
    expect(batches.size).toBe(1);
    expect([...batches][0]).not.toBeNull();
  });

  it("sweeps nothing from a live-only map, and writes no row", async () => {
    const workspace = await arrange();
    await seeded((seed) => seed.graphNode({ workspaceId: workspace.workspaceId }));

    const swept = await sweeping(workspace);

    expect(swept).toEqual({ ok: true, value: [] });
    expect(await rowsOf(workspace.workspaceId, 1)).toEqual([1, 0]);
    expect(await sweptEvents(workspace.workspaceId)).toEqual([]);
  });

  it("sweeps nothing in a workspace without a generation row", async () => {
    const workspace = await arrange();

    await seeded(async (seed) => {
      await seed.graphGeneration({ workspaceId: workspace.workspaceId, liveGen: 7 });
      await seed.graphNode({ workspaceId: workspace.workspaceId, gen: 7 });
    });
    await db().pool.query("DELETE FROM graph_generation WHERE workspace_id = $1", [
      workspace.workspaceId,
    ]);

    const swept = await sweeping(workspace);

    expect(swept).toEqual({ ok: true, value: [] });
    expect(await rowsOf(workspace.workspaceId, 7)).toEqual([1, 0]);
  });

  it("sweeps one workspace's leftovers and never a neighbour's", async () => {
    const ours = await arrange();
    const theirs = await arrange();
    await mapWithLeftovers(ours);
    await mapWithLeftovers(theirs);

    const swept = await sweeping(ours);

    expect(swept).toEqual({ ok: true, value: [{ gen: 2, nodes: 2, edges: 1 }] });
    expect(await rowsOf(theirs.workspaceId, 2)).toEqual([2, 1]);
  });

  it("says a workspace that is not an id is malformed", async () => {
    const workspace = await arrange();

    const swept = await sweeping(workspace, "ws_synthetic");

    expect(swept).toEqual({ ok: false, error: "malformed" });
  });
});

describe("rebuilding a workspace's map", () => {
  it("queues a full rebuild and answers the queued job's id", async () => {
    const workspace = await arrange();

    const rebuilt = await rebuilding(workspace);

    const jobs = await jobsOf(workspace.workspaceId);
    expect(jobs).toEqual([
      { id: expect.any(String), kind: "full-rebuild", reason: "upgrade", status: "queued" },
    ]);
    expect(rebuilt).toEqual({ ok: true, value: { jobId: jobs[0]?.id } });
  });

  it("says a workspace that is not an id is malformed", async () => {
    const workspace = await arrange();

    const rebuilt = await rebuilding(workspace, "ws_synthetic");

    expect(rebuilt).toEqual({ ok: false, error: "malformed" });
  });
});

describe("a sweep whose audit event cannot be written", () => {
  it("removes no generation at all", async () => {
    const workspace = await arrange();
    await mapWithLeftovers(workspace);
    await db().pool.query("REVOKE INSERT ON audit_event FROM app_rt");
    try {
      const swept = await sweeping(workspace);

      expect(swept.ok).toBe(false);
      expect(await rowsOf(workspace.workspaceId, 2)).toEqual([2, 1]);
      expect(await rowsOf(workspace.workspaceId, 1)).toEqual([2, 1]);
    } finally {
      await db().pool.query("GRANT INSERT ON audit_event TO app_rt");
    }
  });
});
