import { testData } from "@better-answers/schema/testing";
import { describe, expect, it } from "vitest";

import type { PlatformPrincipal } from "../src/kernel/index.ts";
import { bundleHealth, enqueueJob, JOB_IS_OVER, jobById } from "../src/runs/index.ts";
import { suiteWithBundles } from "./workspace-with-bundle.ts";

/**
 * The principal `pnpm ops graph-rebuild` runs under: the platform acting as itself, with no
 * person behind it and no workspace of its own. It is the whole reason the enqueue takes a
 * `Principal` rather than a person's — the drill runs from cron inside a container, and work
 * that outlives a session runs under a platform principal, never a live one.
 */
const graphMaintenance: PlatformPrincipal = {
  kind: "platform",
  actorId: "process:better-answers-graph",
};

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
  jobId?: string,
) => {
  const client = await db().pool.connect();
  try {
    const seed = testData(client);
    await client.query("DELETE FROM job WHERE workspace_id = $1 AND id = $2", [
      workspaceId,
      jobId ?? "",
    ]);
    await seed.job({
      workspaceId,
      ...(jobId === undefined ? {} : { id: jobId }),
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
      workspaceId: scenario.workspaceId,
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
        id: queued.value.jobId,
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
      workspaceId: scenario.workspaceId,
      kind: "nightly-audit",
    });

    expect(queued.ok).toBe(true);
    const rows = await db().pool.query<{ reason: string | null }>(
      "SELECT reason FROM job WHERE workspace_id = $1",
      [scenario.workspaceId],
    );
    expect(rows.rows).toEqual([{ reason: null }]);
  });

  it("queues for the platform, which names the workspace because it holds none of its own", async () => {
    // `pnpm ops graph-rebuild` has no session to resolve, so the workspace is the argument
    // and the scope is set from it — the Postgres door's own shape for a platform act.
    const scenario = await arrange();

    const queued = await enqueueJob(graphMaintenance, scenario.postgres, {
      workspaceId: scenario.workspaceId,
      kind: "full-rebuild",
      reason: "reconciler",
    });

    if (!queued.ok) throw new Error(`the job was not queued: ${String(queued.error)}`);
    const rows = await db().pool.query<{ id: string; reason: string }>(
      "SELECT id, reason FROM job WHERE workspace_id = $1",
      [scenario.workspaceId],
    );
    expect(rows.rows).toEqual([{ id: queued.value.jobId, reason: "reconciler" }]);
  });

  it("refuses a person who names another tenant's workspace, rather than quietly using their own", async () => {
    // A caller that named another tenant has the wrong idea; handing it a job in its own
    // workspace would bury that, and RLS would have refused the row anyway.
    const scenario = await arrange();
    const elsewhere = await arrange();

    const queued = await enqueueJob(scenario.admin, scenario.postgres, {
      workspaceId: elsewhere.workspaceId,
      kind: "nightly-audit",
    });

    expect(queued).toEqual({ ok: false, error: "malformed" });
    const rows = await db().pool.query("SELECT 1 FROM job WHERE workspace_id = ANY($1::text[])", [
      [scenario.workspaceId, elsewhere.workspaceId],
    ]);
    expect(rows.rowCount).toBe(0);
  });

  it("refuses a rebuild with no reason and an audit that carries one, before any statement", async () => {
    const scenario = await arrange();

    const noReason = await enqueueJob(graphMaintenance, scenario.postgres, {
      workspaceId: scenario.workspaceId,
      kind: "full-rebuild",
    } as Parameters<typeof enqueueJob>[2]);
    const spuriousReason = await enqueueJob(graphMaintenance, scenario.postgres, {
      workspaceId: scenario.workspaceId,
      kind: "nightly-audit",
      reason: "drill",
    } as Parameters<typeof enqueueJob>[2]);

    expect([noReason, spuriousReason]).toEqual([
      { ok: false, error: "malformed" },
      { ok: false, error: "malformed" },
    ]);
  });

  it("refuses an Editor and a Viewer, because a rebuild is an act over the whole workspace", async () => {
    const scenario = await arrange();

    for (const person of [scenario.editor, scenario.viewer]) {
      const queued = await enqueueJob(person, scenario.postgres, {
        workspaceId: scenario.workspaceId,
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

describe("waiting on a job somebody queued", () => {
  it("answers the job's status and its outcome, so a caller can poll the one it queued", async () => {
    const scenario = await arrange();
    const queued = await enqueueJob(graphMaintenance, scenario.postgres, {
      workspaceId: scenario.workspaceId,
      kind: "full-rebuild",
      reason: "drill",
    });
    if (!queued.ok) throw new Error(`the job was not queued: ${String(queued.error)}`);

    const waiting = await jobById(graphMaintenance, scenario.postgres, {
      workspaceId: scenario.workspaceId,
      jobId: queued.value.jobId,
    });

    expect(waiting).toEqual({
      ok: true,
      value: {
        jobId: queued.value.jobId,
        kind: "full-rebuild",
        reason: "drill",
        status: "queued",
        attempts: 0,
        outcome: null,
      },
    });
    // Nothing terminal yet, which is what keeps a `--wait` polling.
    expect(JOB_IS_OVER).not.toContain(waiting.ok ? waiting.value.status : "queued");

    // And once a worker has finished it, the same read carries what it found.
    await finishedAudit(
      scenario.workspaceId,
      { checked: 2, mismatched: [] },
      new Date("2026-09-07T02:00:00Z"),
      queued.value.jobId,
    );
    const over = await jobById(graphMaintenance, scenario.postgres, {
      workspaceId: scenario.workspaceId,
      jobId: queued.value.jobId,
    });
    expect(over.ok && over.value.status).toBe("done");
    expect(over.ok && over.value.outcome).toEqual({ checked: 2, mismatched: [] });
  });

  it("answers a person polling in their own workspace, whichever road queued the job", async () => {
    // The two roads meet on one row: cron queues the audit as the platform, and the
    // workspace's own Admin reads that job back through their membership. A `--wait` on the
    // ops command and a person asking after the same job are one read, not two.
    const scenario = await arrange();
    const cron = await enqueueJob(graphMaintenance, scenario.postgres, {
      workspaceId: scenario.workspaceId,
      kind: "nightly-audit",
    });
    if (!cron.ok) throw new Error(`the job was not queued: ${String(cron.error)}`);

    const asked = await jobById(scenario.admin, scenario.postgres, {
      workspaceId: scenario.workspaceId,
      jobId: cron.value.jobId,
    });

    expect(asked.ok && asked.value).toEqual({
      jobId: cron.value.jobId,
      kind: "nightly-audit",
      reason: null,
      status: "queued",
      attempts: 0,
      outcome: null,
    });
  });

  it("refuses a Viewer and an Editor, because an audit's outcome names the bundle's files", async () => {
    // `bundleHealth`'s gate, for the material it has it for: a finished audit's outcome lists
    // every file whose hash disagreed with its row, and no other read in this slice shows a
    // member below Admin the shape of the bundle. Scope does not decide it — every member of
    // the workspace passes the policy — so the role is checked in front of the read.
    const scenario = await arrange();
    const cron = await enqueueJob(graphMaintenance, scenario.postgres, {
      workspaceId: scenario.workspaceId,
      kind: "nightly-audit",
    });
    if (!cron.ok) throw new Error(`the job was not queued: ${String(cron.error)}`);
    const asking = { workspaceId: scenario.workspaceId, jobId: cron.value.jobId };

    for (const person of [scenario.viewer, scenario.editor]) {
      const asked = await jobById(person, scenario.postgres, asking);
      expect({ role: person.role, asked }).toEqual({
        role: person.role,
        asked: { ok: false, error: "role-forbids" },
      });
    }
    // The two roads that may read it are unaffected: the workspace's Admin, and the platform
    // principal the ops command's `--wait` polls under, which has no role to check at all.
    expect((await jobById(scenario.admin, scenario.postgres, asking)).ok).toBe(true);
    expect((await jobById(graphMaintenance, scenario.postgres, asking)).ok).toBe(true);
  });

  it("says no-such-job for an id this workspace never held, rather than an empty answer", async () => {
    // A caller polling an id it was never given has the wrong id or the wrong workspace; a
    // null would let it poll that mistake until its timeout.
    const scenario = await arrange();
    const elsewhere = await arrange();
    const queued = await enqueueJob(graphMaintenance, elsewhere.postgres, {
      workspaceId: elsewhere.workspaceId,
      kind: "nightly-audit",
    });
    if (!queued.ok) throw new Error(`the job was not queued: ${String(queued.error)}`);

    expect(
      await jobById(graphMaintenance, scenario.postgres, {
        workspaceId: scenario.workspaceId,
        jobId: queued.value.jobId,
      }),
    ).toEqual({ ok: false, error: "no-such-job" });
    expect(
      await jobById(scenario.admin, scenario.postgres, {
        workspaceId: elsewhere.workspaceId,
        jobId: queued.value.jobId,
      }),
    ).toEqual({ ok: false, error: "no-such-job" });
  });
});

describe("what the platform can say about the two parsers agreeing", () => {
  it("says never-audited until an audit has finished", async () => {
    const scenario = await arrange();
    // A job that is only queued has found nothing yet, so it says nothing about health.
    await enqueueJob(scenario.admin, scenario.postgres, {
      workspaceId: scenario.workspaceId,
      kind: "nightly-audit",
    });

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
