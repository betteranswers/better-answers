import { testData } from "@better-answers/schema/testing";
import { describe, expect, it } from "vitest";

import { bundleHealth, enqueueJob } from "../src/runs/index.ts";
import { suiteWithBundles } from "./workspace-with-bundle.ts";

/**
 * The runs slice through its own interface (`[TEST1]`): what the app may put on the
 * worker's queue, who may put it there, and what the platform can say afterwards about the
 * two parsers agreeing.
 *
 * The worker's side of these rows — claiming, running, finishing — is the queue agreement's
 * (`contracts/queue/`) and the worker's own suite's. What is proved here is the app's half:
 * that a job lands as the row the database will hand out, that an Editor cannot queue one,
 * and that `bundleHealth` reads the latest finished audit and nothing else.
 */

const { db, arrange } = suiteWithBundles();

/** What the worker would have written when it finished an audit, as the app sees it. */
const finishedAudit = async (
  workspaceId: string,
  outcome: Readonly<Record<string, unknown>>,
  finishedAt: Date,
) => {
  const client = await db().pool.connect();
  try {
    const seed = testData(client);
    await seed.job({
      workspaceId,
      kind: "nightly-audit",
      status: "done",
      attempts: 1,
      claimedBy: "worker-1",
      claimedAt: finishedAt,
      finishedAt,
      outcome,
    });
  } finally {
    client.release();
  }
};

describe("what the app puts on the worker's queue", () => {
  it("queues a rebuild for one of the six reasons, and answers the id it queued", async () => {
    const scenario = await arrange();

    const queued = await enqueueJob(scenario.admin, scenario.postgres, {
      kind: "full-rebuild",
      reason: "drill",
    });

    if (!queued.ok) throw new Error(`the job was not queued: ${String(queued.error)}`);
    const rows = await db().pool.query(
      "SELECT id, kind, reason, status, attempts, claimed_by FROM job WHERE workspace_id = $1",
      [scenario.workspaceId],
    );
    expect(rows.rows).toEqual([
      {
        id: queued.value,
        kind: "full-rebuild",
        reason: "drill",
        status: "queued",
        attempts: 0,
        claimed_by: null,
      },
    ]);
  });

  it("queues a nightly audit, which carries no reason at all", async () => {
    const scenario = await arrange();

    const queued = await enqueueJob(scenario.admin, scenario.postgres, {
      kind: "nightly-audit",
    });

    expect(queued.ok).toBe(true);
    const rows = await db().pool.query<{ reason: string | null }>(
      "SELECT reason FROM job WHERE workspace_id = $1",
      [scenario.workspaceId],
    );
    expect(rows.rows).toEqual([{ reason: null }]);
  });

  it("refuses an Editor and a Viewer, because a rebuild is an act over the whole workspace", async () => {
    const scenario = await arrange();

    for (const person of [scenario.editor, scenario.viewer]) {
      const queued = await enqueueJob(person, scenario.postgres, {
        kind: "full-rebuild",
        reason: "drill",
      });
      expect({ role: person.role, ok: queued.ok }).toEqual({ role: person.role, ok: false });
    }
    const rows = await db().pool.query("SELECT 1 FROM job WHERE workspace_id = $1", [
      scenario.workspaceId,
    ]);
    expect(rows.rowCount).toBe(0);
  });
});

describe("what the platform can say about the two parsers agreeing", () => {
  it("says never-audited until an audit has finished", async () => {
    const scenario = await arrange();
    // A job that is only queued has found nothing yet, so it says nothing about health.
    await enqueueJob(scenario.admin, scenario.postgres, { kind: "nightly-audit" });

    const health = await bundleHealth(scenario.admin, scenario.postgres);

    expect(health).toEqual({ ok: true, value: "never-audited" });
  });

  it("says healthy when the last audit found no mismatch", async () => {
    const scenario = await arrange();
    await finishedAudit(
      scenario.workspaceId,
      { checked: 3, mismatched: [], unparsed: [] },
      new Date("2026-09-07T02:00:00Z"),
    );

    expect(await bundleHealth(scenario.admin, scenario.postgres)).toEqual({
      ok: true,
      value: "healthy",
    });
  });

  it("reads the latest finished audit, so a mismatch put right stops being one", async () => {
    const scenario = await arrange();
    await finishedAudit(
      scenario.workspaceId,
      { checked: 3, mismatched: [{ path: "knowledge/expenses.md" }] },
      new Date("2026-09-06T02:00:00Z"),
    );

    expect(await bundleHealth(scenario.admin, scenario.postgres)).toEqual({
      ok: true,
      value: "mismatched",
    });

    await finishedAudit(
      scenario.workspaceId,
      { checked: 3, mismatched: [] },
      new Date("2026-09-07T02:00:00Z"),
    );

    expect(await bundleHealth(scenario.admin, scenario.postgres)).toEqual({
      ok: true,
      value: "healthy",
    });
  });

  it("refuses a reader who is not an Admin, because health is the workspace's own state", async () => {
    const scenario = await arrange();
    await finishedAudit(
      scenario.workspaceId,
      { checked: 1, mismatched: [] },
      new Date("2026-09-07T02:00:00Z"),
    );

    expect(await bundleHealth(scenario.editor, scenario.postgres)).toEqual({
      ok: false,
      error: "role-forbids",
    });
  });
});
