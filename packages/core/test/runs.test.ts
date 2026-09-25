import { testData } from "@better-answers/schema/testing";
import { describe, expect, it } from "vitest";

import type { PlatformPrincipal, WorkspaceId } from "../src/kernel/index.ts";
import { bundleHealth, enqueueJob, enqueueJobIn, JOB_IS_OVER, jobById } from "../src/runs/index.ts";
import { folded, withMembership, withScope, type Tx } from "../src/store/postgres/index.ts";
import { abortTheTransaction } from "./suite-postgres.ts";
import { suiteWithBundles, type Scenario } from "./workspace-with-bundle.ts";

const graphMaintenance: PlatformPrincipal = {
  kind: "platform",
  actorId: "process:better-answers-graph",
};

const { db, arrange } = suiteWithBundles();

const auditQueuedByCron = async (
  scenario: Awaited<ReturnType<typeof arrange>>,
): Promise<string> => {
  const cron = await enqueueJob(graphMaintenance, scenario.postgres, {
    workspaceId: scenario.workspaceId,
    kind: "nightly-audit",
  });
  if (!cron.ok) throw new Error(`the job was not queued: ${String(cron.error)}`);
  return cron.value.jobId;
};

const NOTHING_FOUND = {
  checked: 1,
  mismatched: [],
  unparsed: [],
  missing_row: [],
  missing_file: [],
} as const;

const outcomeWrittenRaw = async (workspaceId: string, jobId: string, outcome: unknown) => {
  await db().pool.query("UPDATE job SET outcome = $3 WHERE workspace_id = $1 AND id = $2", [
    workspaceId,
    jobId,
    JSON.stringify(outcome),
  ]);
};

const foundNothingOn = (workspaceId: string, at: string) =>
  finishedAudit(workspaceId, { ...NOTHING_FOUND, checked: 3 }, new Date(at));

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

describe("what the api puts on the worker's queue", () => {
  it("queues a rebuild for a reason and answers its id", async () => {
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

  it("queues for the platform in the workspace it names", async () => {
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

  it("refuses a person naming another tenant's workspace, queuing nothing", async () => {
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

  it("refuses a reasonless rebuild and an audit carrying a reason", async () => {
    const scenario = await arrange();

    // @ts-expect-error a rebuild without its reason is outside the input, on purpose
    const noReason = await enqueueJob(graphMaintenance, scenario.postgres, {
      workspaceId: scenario.workspaceId,
      kind: "full-rebuild",
    });
    const spuriousReason = await enqueueJob(graphMaintenance, scenario.postgres, {
      workspaceId: scenario.workspaceId,
      kind: "nightly-audit",
      // @ts-expect-error an audit carries no reason, on purpose
      reason: "drill",
    });

    expect([noReason, spuriousReason]).toEqual([
      { ok: false, error: "malformed" },
      { ok: false, error: "malformed" },
    ]);
  });

  it("refuses a rebuild to an Editor and a Viewer", async () => {
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

const BINDING = "01K4Q9F3V8YXP7R2M6ZKWC3TDS";

const ANOTHER_BINDING = "01K4Q9F3V8YXP7R2M6ZKWC3TDT";

const boundJob = (workspaceId: WorkspaceId) =>
  ({ workspaceId, kind: "index", subjectId: BINDING, reason: "bound" }) as const;

const actOf = <T>(scenario: Scenario, work: (tx: Tx) => Promise<T>): Promise<T> =>
  withScope(graphMaintenance, scenario.postgres, scenario.workspaceId, (tx) => work(tx));

const jobsIn = async (workspaceId: string) =>
  (
    await db().pool.query(
      "SELECT id, kind, subject_id, reason, status FROM job WHERE workspace_id = $1 ORDER BY enqueued_at",
      [workspaceId],
    )
  ).rows;

const queuedBound = async (scenario: Scenario): Promise<string> => {
  const first = await actOf(scenario, (tx) =>
    enqueueJobIn(graphMaintenance, tx, boundJob(scenario.workspaceId)),
  );
  if (!first.ok) throw new Error(`the job was not queued: ${String(first.error)}`);
  return first.value.jobId;
};

const reasonsIn = async (workspaceId: string): Promise<readonly string[]> =>
  (await jobsIn(workspaceId)).map((row: { reason: string }) => row.reason);

describe("an act landing its rows and job in one transaction", () => {
  it("rolls back with the act it rode in, queuing nothing", async () => {
    const scenario = await arrange();

    const act = actOf(scenario, async (tx) => {
      const enqueued = await enqueueJobIn(graphMaintenance, tx, boundJob(scenario.workspaceId));

      await abortTheTransaction(tx);
      return enqueued;
    });

    await expect(act).rejects.toThrow("the transaction did not commit");
    expect(await jobsIn(scenario.workspaceId)).toEqual([]);
  });

  it("answers an already-queued binding's job id, and the act commits", async () => {
    const scenario = await arrange();
    const firstJobId = await queuedBound(scenario);

    const second = await actOf(scenario, async (tx) => {
      const answered = await enqueueJobIn(graphMaintenance, tx, {
        ...boundJob(scenario.workspaceId),
        reason: "restored",
      });
      await tx.query("SELECT 1");
      return answered;
    });

    expect(second).toEqual({ ok: true, value: { jobId: firstJobId } });

    expect(await jobsIn(scenario.workspaceId)).toEqual([
      {
        id: firstJobId,
        kind: "index",
        subject_id: BINDING,
        reason: "bound",
        status: "queued",
      },
    ]);
  });

  it.each([
    ["rule-change", "wiped"],
    ["wiped", "rule-change"],
  ] as const)(
    "takes %s onto the queued job, keeping it past %s",
    async (emptying, alsoEmptying) => {
      const scenario = await arrange();
      const firstJobId = await queuedBound(scenario);

      const taken = await actOf(scenario, (tx) =>
        enqueueJobIn(graphMaintenance, tx, { ...boundJob(scenario.workspaceId), reason: emptying }),
      );
      expect(taken).toEqual({ ok: true, value: { jobId: firstJobId } });
      expect(await reasonsIn(scenario.workspaceId)).toEqual([emptying]);

      for (const reason of ["restored", alsoEmptying] as const) {
        const later = await actOf(scenario, (tx) =>
          enqueueJobIn(graphMaintenance, tx, { ...boundJob(scenario.workspaceId), reason }),
        );
        expect(later).toEqual({ ok: true, value: { jobId: firstJobId } });
        expect(await reasonsIn(scenario.workspaceId)).toEqual([emptying]);
      }
    },
  );

  it("queues a second binding separately, one run key per subject", async () => {
    const scenario = await arrange();

    const firstJobId = await queuedBound(scenario);
    const other = await actOf(scenario, (tx) =>
      enqueueJobIn(graphMaintenance, tx, {
        ...boundJob(scenario.workspaceId),
        subjectId: ANOTHER_BINDING,
      }),
    );

    if (!other.ok) throw new Error("a job was not queued");
    expect(await jobsIn(scenario.workspaceId)).toEqual([
      {
        id: firstJobId,
        kind: "index",
        subject_id: BINDING,
        reason: "bound",
        status: "queued",
      },
      {
        id: other.value.jobId,
        kind: "index",
        subject_id: ANOTHER_BINDING,
        reason: "bound",
        status: "queued",
      },
    ]);
  });

  it.each([
    ["an index job with no subject", { kind: "index", reason: "bound" }],
    ["a nightly audit that names one", { kind: "nightly-audit", subjectId: BINDING }],
    ["a rebuild with none of its six reasons", { kind: "full-rebuild" }],
    ["an index reason on a rebuild", { kind: "full-rebuild", reason: "bound" }],
    ["a rebuild reason on an index job", { kind: "index", subjectId: BINDING, reason: "drill" }],
    ["a kind the queue does not carry", { kind: "prune", subjectId: BINDING }],
  ])(
    "refuses %s as malformed, rather than aborting the act's transaction",
    async (_what, asked) => {
      const scenario = await arrange();

      const refused = await actOf(scenario, (tx) =>
        // @ts-expect-error each row is outside the queue's input, on purpose
        enqueueJobIn(graphMaintenance, tx, {
          workspaceId: scenario.workspaceId,
          ...asked,
        }),
      );

      expect(refused).toEqual({ ok: false, error: "malformed" });
      expect(await jobsIn(scenario.workspaceId)).toEqual([]);
    },
  );

  it("gates the enqueue on the role the kind's descriptor names", async () => {
    const scenario = await arrange();

    const editor = folded(
      await withMembership(scenario.editor, scenario.postgres, (_fresh, tx) =>
        enqueueJobIn(scenario.editor, tx, boundJob(scenario.workspaceId)),
      ),
    );
    const admin = folded(
      await withMembership(scenario.admin, scenario.postgres, (_fresh, tx) =>
        enqueueJobIn(scenario.admin, tx, boundJob(scenario.workspaceId)),
      ),
    );

    expect(editor).toEqual({ ok: false, error: "role-forbids" });
    expect(admin.ok).toBe(true);
    expect((await jobsIn(scenario.workspaceId)).length).toBe(1);
  });

  it("lands a job queued through the door with its subject", async () => {
    const scenario = await arrange();

    const queued = await enqueueJob(
      scenario.admin,
      scenario.postgres,
      boundJob(scenario.workspaceId),
    );

    if (!queued.ok) throw new Error(`the job was not queued: ${String(queued.error)}`);
    expect(await jobsIn(scenario.workspaceId)).toEqual([
      {
        id: queued.value.jobId,
        kind: "index",
        subject_id: BINDING,
        reason: "bound",
        status: "queued",
      },
    ]);
  });
});

describe("waiting on a job somebody queued", () => {
  it("answers the job's status and outcome to a polling caller", async () => {
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

    expect(JOB_IS_OVER).not.toContain(waiting.ok ? waiting.value.status : "queued");

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

  it("answers a failure for an outcome outside the queue agreement", async () => {
    const scenario = await arrange();
    const jobId = await auditQueuedByCron(scenario);
    await finishedAudit(
      scenario.workspaceId,
      NOTHING_FOUND,
      new Date("2026-09-07T02:00:00Z"),
      jobId,
    );
    await outcomeWrittenRaw(scenario.workspaceId, jobId, {
      checked: 1,
      mismatched: [{ path: "knowledge/expenses.md", body: { text: "…" } }],
    });

    const read = await jobById(graphMaintenance, scenario.postgres, {
      workspaceId: scenario.workspaceId,
      jobId,
    });

    expect(read.ok).toBe(false);
    expect(read.ok ? "" : String(read.error)).toContain("queue agreement");
  });

  it("answers a person polling their own workspace, whoever queued it", async () => {
    const scenario = await arrange();
    const jobId = await auditQueuedByCron(scenario);

    const asked = await jobById(scenario.admin, scenario.postgres, {
      workspaceId: scenario.workspaceId,
      jobId,
    });

    expect(asked.ok && asked.value).toEqual({
      jobId,
      kind: "nightly-audit",
      reason: null,
      status: "queued",
      attempts: 0,
      outcome: null,
    });
  });

  it("refuses a Viewer and an Editor the audit's outcome", async () => {
    const scenario = await arrange();
    const asking = { workspaceId: scenario.workspaceId, jobId: await auditQueuedByCron(scenario) };

    for (const person of [scenario.viewer, scenario.editor]) {
      const asked = await jobById(person, scenario.postgres, asking);
      expect({ role: person.role, asked }).toEqual({
        role: person.role,
        asked: { ok: false, error: "role-forbids" },
      });
    }

    expect((await jobById(scenario.admin, scenario.postgres, asking)).ok).toBe(true);
    expect((await jobById(graphMaintenance, scenario.postgres, asking)).ok).toBe(true);
  });

  it("says no-such-job for an id this workspace never held", async () => {
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

    await enqueueJob(scenario.admin, scenario.postgres, {
      workspaceId: scenario.workspaceId,
      kind: "nightly-audit",
    });

    const health = await bundleHealth(scenario.admin, scenario.postgres);

    expect(health).toEqual({ ok: true, value: "never-audited" });
  });

  it("says healthy when the last audit found nothing", async () => {
    const scenario = await arrange();

    await foundNothingOn(scenario.workspaceId, "2026-09-07T02:00:00Z");

    expect(await bundleHealth(scenario.admin, scenario.postgres)).toEqual({
      ok: true,
      value: "healthy",
    });
  });

  it.each([
    ["a file whose hash is not the row's", { mismatched: [{ path: "knowledge/expenses.md" }] }],
    ["a file the grammar cannot read", { unparsed: ["knowledge/strange.md"] }],
    ["a file the index does not know", { missing_row: ["knowledge/new.md"] }],
    ["a row whose file is gone", { missing_file: ["knowledge/gone.md"] }],
  ])(
    "says mismatched over %s, the repository and the index disagreeing",
    async (_finding, found) => {
      const scenario = await arrange();
      await finishedAudit(
        scenario.workspaceId,
        { ...NOTHING_FOUND, ...found },
        new Date("2026-09-07T02:00:00Z"),
      );

      expect(await bundleHealth(scenario.admin, scenario.postgres)).toEqual({
        ok: true,
        value: "mismatched",
      });
    },
  );

  it.each([
    ["a list missing", { checked: 3, mismatched: [], unparsed: [] }],
    ["a finding that is not a list", { ...NOTHING_FOUND, mismatched: "" }],
    [
      "an outcome outside the boundary's shape",
      { ...NOTHING_FOUND, mismatched: [{ deep: { path: "x" } }] },
    ],
  ])(
    "says mismatched, never healthy, over an unreadable audit outcome: %s",
    async (_shape, outcome) => {
      const scenario = await arrange();
      const jobId = await auditQueuedByCron(scenario);
      await finishedAudit(
        scenario.workspaceId,
        NOTHING_FOUND,
        new Date("2026-09-07T02:00:00Z"),
        jobId,
      );
      await outcomeWrittenRaw(scenario.workspaceId, jobId, outcome);

      expect(await bundleHealth(scenario.admin, scenario.postgres)).toEqual({
        ok: true,
        value: "mismatched",
      });
    },
  );

  it("reads the latest finished audit, so a fixed mismatch clears", async () => {
    const scenario = await arrange();
    await finishedAudit(
      scenario.workspaceId,
      { ...NOTHING_FOUND, checked: 3, mismatched: [{ path: "knowledge/expenses.md" }] },
      new Date("2026-09-06T02:00:00Z"),
    );

    expect(await bundleHealth(scenario.admin, scenario.postgres)).toEqual({
      ok: true,
      value: "mismatched",
    });

    await foundNothingOn(scenario.workspaceId, "2026-09-07T02:00:00Z");

    expect(await bundleHealth(scenario.admin, scenario.postgres)).toEqual({
      ok: true,
      value: "healthy",
    });
  });

  it("refuses health to a reader who is not an Admin", async () => {
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
