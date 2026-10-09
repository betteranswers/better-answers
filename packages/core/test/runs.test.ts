import { describe, expect, it } from "vitest";

import { testData } from "@better-answers/schema/testing";

import type { PlatformPrincipal, WorkspaceId } from "../src/kernel/index.ts";
import {
  bundleHealth,
  endedSyncs,
  enqueueJob,
  enqueueJobIn,
  JOB_IS_OVER,
  jobById,
  lockSyncIn,
  type SyncScan,
} from "../src/runs/index.ts";
import { folded, withMember, withScope, type Tx } from "../src/store/postgres/index.ts";
import { seededBy } from "./sourced-concept.ts";
import { abortTheTransaction, countWaitingOnLocks, readingAs, until } from "./suite-postgres.ts";
import { suiteWithBundles, type Scenario } from "./workspace-with-bundle.ts";

const mapMaintenance: PlatformPrincipal = {
  kind: "platform",
  actorId: "process:better-answers-graph",
};

const { db, arrange } = suiteWithBundles();

const auditQueuedByCron = async (
  scenario: Awaited<ReturnType<typeof arrange>>,
): Promise<string> => {
  const cron = await enqueueJob(mapMaintenance, scenario.postgres, {
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

    const queued = await enqueueJob(mapMaintenance, scenario.postgres, {
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
    const noReason = await enqueueJob(mapMaintenance, scenario.postgres, {
      workspaceId: scenario.workspaceId,
      kind: "full-rebuild",
    });
    const spuriousReason = await enqueueJob(mapMaintenance, scenario.postgres, {
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

const CONNECTED_SOURCE = "01K4Q9F3V8YXP7R2M6ZKWC3TDS";

const ANOTHER_CONNECTED_SOURCE = "01K4Q9F3V8YXP7R2M6ZKWC3TDT";

const boundJob = (workspaceId: WorkspaceId) =>
  ({ workspaceId, kind: "index", subjectId: CONNECTED_SOURCE, reason: "connected" }) as const;

const actionOf = <T>(scenario: Scenario, work: (tx: Tx) => Promise<T>): Promise<T> =>
  withScope(mapMaintenance, scenario.postgres, scenario.workspaceId, (tx) => work(tx));

const jobsIn = async (workspaceId: string) =>
  (
    await db().pool.query(
      "SELECT id, kind, subject_id, reason, status FROM job WHERE workspace_id = $1 ORDER BY enqueued_at",
      [workspaceId],
    )
  ).rows;

const queuedBound = async (scenario: Scenario): Promise<string> => {
  const first = await actionOf(scenario, (tx) =>
    enqueueJobIn(mapMaintenance, tx, boundJob(scenario.workspaceId)),
  );
  if (!first.ok) throw new Error(`the job was not queued: ${String(first.error)}`);
  return first.value.jobId;
};

const reasonsIn = async (workspaceId: string): Promise<readonly string[]> =>
  (await jobsIn(workspaceId)).map((row: { reason: string }) => row.reason);

describe("an action landing its rows and job in one transaction", () => {
  it("rolls back with the action it rode in, queuing nothing", async () => {
    const scenario = await arrange();

    const action = actionOf(scenario, async (tx) => {
      const enqueued = await enqueueJobIn(mapMaintenance, tx, boundJob(scenario.workspaceId));

      await abortTheTransaction(tx);
      return enqueued;
    });

    await expect(action).rejects.toThrow("the transaction did not commit");
    expect(await jobsIn(scenario.workspaceId)).toEqual([]);
  });

  it("answers an already-queued source's job id, and the action commits", async () => {
    const scenario = await arrange();
    const firstJobId = await queuedBound(scenario);

    const second = await actionOf(scenario, async (tx) => {
      const answered = await enqueueJobIn(mapMaintenance, tx, {
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
        subject_id: CONNECTED_SOURCE,
        reason: "connected",
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

      const taken = await actionOf(scenario, (tx) =>
        enqueueJobIn(mapMaintenance, tx, { ...boundJob(scenario.workspaceId), reason: emptying }),
      );
      expect(taken).toEqual({ ok: true, value: { jobId: firstJobId } });
      expect(await reasonsIn(scenario.workspaceId)).toEqual([emptying]);

      for (const reason of ["restored", alsoEmptying] as const) {
        const later = await actionOf(scenario, (tx) =>
          enqueueJobIn(mapMaintenance, tx, { ...boundJob(scenario.workspaceId), reason }),
        );
        expect(later).toEqual({ ok: true, value: { jobId: firstJobId } });
        expect(await reasonsIn(scenario.workspaceId)).toEqual([emptying]);
      }
    },
  );

  it("rejects an enqueue that another action's commit overtook", async () => {
    const scenario = await arrange();
    const firstLanded = Promise.withResolvers<undefined>();
    const held = Promise.withResolvers<undefined>();
    const first = actionOf(scenario, async (tx) => {
      const queued = await enqueueJobIn(mapMaintenance, tx, boundJob(scenario.workspaceId));
      firstLanded.resolve(undefined);
      await held.promise;
      return queued;
    });
    await firstLanded.promise;

    const second = actionOf(scenario, (tx) =>
      enqueueJobIn(mapMaintenance, tx, boundJob(scenario.workspaceId)),
    ).then(
      () => "committed",
      (error: unknown) => error,
    );
    try {
      await until(async () => (await countWaitingOnLocks(db().pool)) > 0);
    } finally {
      held.resolve(undefined);
    }

    expect(await first).toEqual({ ok: true, value: { jobId: expect.any(String) } });
    expect(await second).toEqual(
      new Error("another action queued this subject while this one was enqueueing it"),
    );
    expect(await jobsIn(scenario.workspaceId)).toHaveLength(1);
  });

  it("queues a second source separately, one run key per subject", async () => {
    const scenario = await arrange();

    const firstJobId = await queuedBound(scenario);
    const other = await actionOf(scenario, (tx) =>
      enqueueJobIn(mapMaintenance, tx, {
        ...boundJob(scenario.workspaceId),
        subjectId: ANOTHER_CONNECTED_SOURCE,
      }),
    );

    if (!other.ok) throw new Error("a job was not queued");
    expect(await jobsIn(scenario.workspaceId)).toEqual([
      {
        id: firstJobId,
        kind: "index",
        subject_id: CONNECTED_SOURCE,
        reason: "connected",
        status: "queued",
      },
      {
        id: other.value.jobId,
        kind: "index",
        subject_id: ANOTHER_CONNECTED_SOURCE,
        reason: "connected",
        status: "queued",
      },
    ]);
  });

  it.each([
    ["an index job with no subject", { kind: "index", reason: "connected" }],
    ["a nightly audit naming a subject", { kind: "nightly-audit", subjectId: CONNECTED_SOURCE }],
    ["a rebuild with none of its reasons", { kind: "full-rebuild" }],
    ["an index reason on a rebuild", { kind: "full-rebuild", reason: "connected" }],
    [
      "a rebuild reason on an index job",
      { kind: "index", subjectId: CONNECTED_SOURCE, reason: "drill" },
    ],
    ["a kind the queue does not carry", { kind: "prune", subjectId: CONNECTED_SOURCE }],
  ])("refuses %s as malformed", async (_what, asked) => {
    const scenario = await arrange();

    const refused = await actionOf(scenario, (tx) =>
      // @ts-expect-error each row is outside the queue's input, on purpose
      enqueueJobIn(mapMaintenance, tx, {
        workspaceId: scenario.workspaceId,
        ...asked,
      }),
    );

    expect(refused, "refused, rather than aborting the action's transaction").toEqual({
      ok: false,
      error: "malformed",
    });
    expect(await jobsIn(scenario.workspaceId)).toEqual([]);
  });

  it("gates the enqueue on the role the kind's descriptor names", async () => {
    const scenario = await arrange();

    const editor = folded(
      await withMember(scenario.editor, scenario.postgres, (_fresh, tx) =>
        enqueueJobIn(scenario.editor, tx, boundJob(scenario.workspaceId)),
      ),
    );
    const admin = folded(
      await withMember(scenario.admin, scenario.postgres, (_fresh, tx) =>
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
        subject_id: CONNECTED_SOURCE,
        reason: "connected",
        status: "queued",
      },
    ]);
  });
});

describe("waiting on a job somebody queued", () => {
  it("answers the job's status and outcome to a polling caller", async () => {
    const scenario = await arrange();
    const queued = await enqueueJob(mapMaintenance, scenario.postgres, {
      workspaceId: scenario.workspaceId,
      kind: "full-rebuild",
      reason: "drill",
    });
    if (!queued.ok) throw new Error(`the job was not queued: ${String(queued.error)}`);

    const waiting = await jobById(mapMaintenance, scenario.postgres, {
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
    const over = await jobById(mapMaintenance, scenario.postgres, {
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

    const read = await jobById(mapMaintenance, scenario.postgres, {
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
    expect((await jobById(mapMaintenance, scenario.postgres, asking)).ok).toBe(true);
  });

  it("says no-such-job for an id this workspace never held", async () => {
    const scenario = await arrange();
    const elsewhere = await arrange();
    const queued = await enqueueJob(mapMaintenance, elsewhere.postgres, {
      workspaceId: elsewhere.workspaceId,
      kind: "nightly-audit",
    });
    if (!queued.ok) throw new Error(`the job was not queued: ${String(queued.error)}`);

    expect(
      await jobById(mapMaintenance, scenario.postgres, {
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
    ["a file hashed unlike its row", { mismatched: [{ path: "knowledge/expenses.md" }] }],
    ["a file the grammar cannot read", { unparsed: ["knowledge/strange.md"] }],
    ["a file the index does not know", { missing_row: ["knowledge/new.md"] }],
    ["a row whose file is gone", { missing_file: ["knowledge/gone.md"] }],
  ])("says mismatched over %s", async (_finding, found) => {
    const scenario = await arrange();
    await finishedAudit(
      scenario.workspaceId,
      { ...NOTHING_FOUND, ...found },
      new Date("2026-09-07T02:00:00Z"),
    );

    expect(
      await bundleHealth(scenario.admin, scenario.postgres),
      "the repository and the index disagree",
    ).toEqual({ ok: true, value: "mismatched" });
  });

  it.each([
    ["a list missing", { checked: 3, mismatched: [], unparsed: [] }],
    ["a non-list finding", { ...NOTHING_FOUND, mismatched: "" }],
    ["a misshapen entry", { ...NOTHING_FOUND, mismatched: [{ deep: { path: "x" } }] }],
  ])("says mismatched over an unreadable audit outcome: %s", async (_shape, outcome) => {
    const scenario = await arrange();
    const jobId = await auditQueuedByCron(scenario);
    await finishedAudit(
      scenario.workspaceId,
      NOTHING_FOUND,
      new Date("2026-09-07T02:00:00Z"),
      jobId,
    );
    await outcomeWrittenRaw(scenario.workspaceId, jobId, outcome);

    expect(
      await bundleHealth(scenario.admin, scenario.postgres),
      "an unreadable outcome is never healthy",
    ).toEqual({ ok: true, value: "mismatched" });
  });

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

const THIRD_CONNECTED_SOURCE = "01K4Q9F3V8YXP7R2M6ZKWC3TDV";

const FIRST_DOCUMENT = "01J6D1AAAAAAAAAAAAAAAAAAAA";

const SECOND_DOCUMENT = "01J6D2AAAAAAAAAAAAAAAAAAAA";

const SYNCED_FROM = new Date("2026-09-01T09:00:00.000Z");

const minutesIn = (minutes: number): Date => new Date(SYNCED_FROM.getTime() + minutes * 60_000);

const MOVED_NOTHING = { passages: 2, sensitivity_moved: [] };

type Ended = {
  readonly status: "done" | "failed" | "poisoned";
  readonly finishedAt: Date;
  readonly outcome: Readonly<Record<string, unknown>> | null;
  readonly attempts?: number;
  readonly subjectId?: string;
};

const claimOf = (subjectId: string) =>
  ({
    kind: "index",
    subjectId,
    reason: "connected",
    enqueuedAt: SYNCED_FROM,
    claimedBy: "worker-1",
    claimedAt: SYNCED_FROM,
    heartbeatAt: SYNCED_FROM,
  }) as const;

const syncEnded = (workspaceId: string, ended: Ended): Promise<string> =>
  seededBy(db(), async (seed) => {
    const job = await seed.job({
      workspaceId,
      ...claimOf(ended.subjectId ?? CONNECTED_SOURCE),
      status: ended.status,
      attempts: ended.attempts ?? 1,
      finishedAt: ended.finishedAt,
      outcome: ended.outcome,
    });
    return job.id;
  });

const syncClaimed = (
  workspaceId: string,
  leaseExpiresAt: Date,
  subjectId = CONNECTED_SOURCE,
): Promise<string> =>
  seededBy(db(), async (seed) => {
    const job = await seed.job({
      workspaceId,
      ...claimOf(subjectId),
      status: "claimed",
      attempts: 1,
      leaseExpiresAt,
    });
    return job.id;
  });

const SINCE_THE_FIRST_SYNC: SyncScan = { kind: "ended-since", at: SYNCED_FROM };

const syncsIn = (scenario: Scenario, scan: SyncScan = SINCE_THE_FIRST_SYNC) =>
  endedSyncs(mapMaintenance, scenario.postgres, {
    workspaceId: scenario.workspaceId,
    scan,
  });

const readWhole = (jobId: string, status: string, attempts: number, endedMinutesIn: number) => ({
  jobId,
  connectedSourceId: CONNECTED_SOURCE,
  status,
  attempts,
  endedAt: minutesIn(endedMinutesIn),
  moved: { kind: "whole-source" },
});

/** Takes the lapsed-sync lock in a step whose transaction stays open until `release`. */
const lockHeldOpen = async (scenario: Scenario, jobId: string) => {
  let locked = false;
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const step = actionOf(scenario, async (tx) => {
    const lock = await lockSyncIn(mapMaintenance, tx, {
      workspaceId: scenario.workspaceId,
      jobId,
      attempts: 1,
    });
    locked = true;
    await released;
    return lock;
  });
  await until(async () => locked);
  return { step, release };
};

describe("the syncs a workspace's step has still to consider", () => {
  it("reads a first attempt's listed documents, and an empty key", async () => {
    const scenario = await arrange();
    const listed = await syncEnded(scenario.workspaceId, {
      status: "done",
      finishedAt: minutesIn(10),
      outcome: {
        passages: 2,
        sensitivity_moved: [FIRST_DOCUMENT, SECOND_DOCUMENT],
      },
    });
    const empty = await syncEnded(scenario.workspaceId, {
      status: "done",
      finishedAt: minutesIn(20),
      outcome: MOVED_NOTHING,
      subjectId: ANOTHER_CONNECTED_SOURCE,
    });

    expect(await syncsIn(scenario)).toEqual({
      ok: true,
      value: [
        {
          jobId: listed,
          connectedSourceId: CONNECTED_SOURCE,
          status: "done",
          attempts: 1,
          endedAt: minutesIn(10),
          moved: {
            kind: "documents",
            documentIds: [FIRST_DOCUMENT, SECOND_DOCUMENT],
          },
        },
        {
          jobId: empty,
          connectedSourceId: ANOTHER_CONNECTED_SOURCE,
          status: "done",
          attempts: 1,
          endedAt: minutesIn(20),
          moved: { kind: "documents", documentIds: [] },
        },
      ],
    });
  });

  it("reads a retried, failed, poisoned, lapsed or keyless sync whole", async () => {
    const scenario = await arrange();
    const { workspaceId } = scenario;
    const retried = await syncEnded(workspaceId, {
      status: "done",
      attempts: 2,
      finishedAt: minutesIn(10),
      outcome: { passages: 2, sensitivity_moved: [FIRST_DOCUMENT] },
    });
    const failed = await syncEnded(workspaceId, {
      status: "failed",
      finishedAt: minutesIn(20),
      outcome: MOVED_NOTHING,
    });
    const poisoned = await syncEnded(workspaceId, {
      status: "poisoned",
      attempts: 3,
      finishedAt: minutesIn(30),
      outcome: null,
    });
    const lapsed = await syncClaimed(workspaceId, minutesIn(40));
    const keyless = await syncEnded(workspaceId, {
      status: "done",
      finishedAt: minutesIn(50),
      outcome: { passages: 2 },
    });

    const read = await syncsIn(scenario);

    expect(read).toEqual({
      ok: true,
      value: [
        readWhole(retried, "done", 2, 10),
        readWhole(failed, "failed", 1, 20),
        readWhole(poisoned, "poisoned", 3, 30),
        readWhole(lapsed, "claimed", 1, 40),
        readWhole(keyless, "done", 1, 50),
      ],
    });
  });

  it("reads an unreadable key or outcome as the whole source", async () => {
    const scenario = await arrange();
    const { workspaceId } = scenario;
    const unreadableKey = await syncEnded(workspaceId, {
      status: "done",
      finishedAt: minutesIn(10),
      outcome: { passages: 2, sensitivity_moved: "not-a-list" },
    });
    const unreadableOutcome = await syncEnded(workspaceId, {
      status: "done",
      finishedAt: minutesIn(20),
      outcome: MOVED_NOTHING,
    });
    await outcomeWrittenRaw(workspaceId, unreadableOutcome, { sensitivity_moved: { deep: [] } });

    expect(await syncsIn(scenario)).toEqual({
      ok: true,
      value: [readWhole(unreadableKey, "done", 1, 10), readWhole(unreadableOutcome, "done", 1, 20)],
    });
  });

  it("never answers a queued job or a live claim", async () => {
    const scenario = await arrange();
    await seededBy(db(), (seed) => seed.job(boundJob(scenario.workspaceId)));
    await syncClaimed(
      scenario.workspaceId,
      new Date(Date.now() + 3_600_000),
      ANOTHER_CONNECTED_SOURCE,
    );
    const done = await syncEnded(scenario.workspaceId, {
      status: "done",
      finishedAt: minutesIn(10),
      outcome: MOVED_NOTHING,
      subjectId: THIRD_CONNECTED_SOURCE,
    });

    const read = await syncsIn(scenario);

    expect(read.ok && read.value.map((sync) => sync.jobId)).toEqual([done]);
  });

  it("answers only syncs that ended at or after the instant", async () => {
    const scenario = await arrange();
    const { workspaceId } = scenario;
    const endedAt = (minutes: number) =>
      syncEnded(workspaceId, {
        status: "done",
        finishedAt: minutesIn(minutes),
        outcome: MOVED_NOTHING,
      });
    await endedAt(10);
    await syncClaimed(workspaceId, minutesIn(15));
    const atTheInstant = await endedAt(20);
    const lapsedAfter = await syncClaimed(workspaceId, minutesIn(25));
    const after = await endedAt(30);

    const read = await syncsIn(scenario, {
      kind: "ended-since",
      at: minutesIn(20),
    });

    expect(read.ok && read.value.map((sync) => sync.jobId)).toEqual([
      atTheInstant,
      lapsedAfter,
      after,
    ]);
  });

  it("answers each source's newest ended sync and every lapsed claim", async () => {
    const scenario = await arrange();
    const { workspaceId } = scenario;
    await syncEnded(workspaceId, {
      status: "done",
      finishedAt: minutesIn(10),
      outcome: MOVED_NOTHING,
    });
    const newest = await syncEnded(workspaceId, {
      status: "poisoned",
      attempts: 3,
      finishedAt: minutesIn(30),
      outcome: null,
    });
    await syncClaimed(workspaceId, new Date(Date.now() + 3_600_000));
    const lapsedBefore = await syncClaimed(workspaceId, minutesIn(5), ANOTHER_CONNECTED_SOURCE);
    const another = await syncEnded(workspaceId, {
      status: "done",
      finishedAt: minutesIn(20),
      outcome: MOVED_NOTHING,
      subjectId: ANOTHER_CONNECTED_SOURCE,
    });
    const onlyLapsed = await syncClaimed(workspaceId, minutesIn(40), THIRD_CONNECTED_SOURCE);

    const read = await syncsIn(scenario, { kind: "newest-per-source" });

    expect(read.ok && read.value.map((sync) => sync.jobId)).toEqual([
      lapsedBefore,
      another,
      newest,
      onlyLapsed,
    ]);
  });

  it("reads only the workspace its principal is scoped to", async () => {
    const scenario = await arrange();
    const elsewhere = await arrange();
    const ours = await syncEnded(scenario.workspaceId, {
      status: "done",
      finishedAt: minutesIn(10),
      outcome: MOVED_NOTHING,
    });
    await syncEnded(elsewhere.workspaceId, {
      status: "done",
      finishedAt: minutesIn(10),
      outcome: MOVED_NOTHING,
    });

    const read = await syncsIn(scenario);

    expect(read.ok && read.value.map((sync) => sync.jobId)).toEqual([ours]);
  });

  it("refuses an Editor the syncs and the lock", async () => {
    const scenario = await arrange();
    const jobId = await syncClaimed(scenario.workspaceId, minutesIn(10));
    const naming = { workspaceId: scenario.workspaceId, jobId, attempts: 1 };

    expect(
      await endedSyncs(scenario.editor, scenario.postgres, {
        workspaceId: scenario.workspaceId,
        scan: SINCE_THE_FIRST_SYNC,
      }),
    ).toEqual({ ok: false, error: "role-forbids" });
    expect(
      await readingAs(db().runtimePool, scenario.editor, (editor, tx) =>
        lockSyncIn(editor, tx, naming),
      ),
    ).toEqual({ ok: false, error: "role-forbids" });
  });

  it("holds a lapsed sync's row until the step's transaction ends", async () => {
    const scenario = await arrange();
    const jobId = await syncClaimed(scenario.workspaceId, minutesIn(10));
    const { step, release } = await lockHeldOpen(scenario, jobId);
    const fenced = db().pool.query(
      "SELECT id FROM job WHERE workspace_id = $1 AND id = $2 FOR KEY SHARE",
      [scenario.workspaceId, jobId],
    );
    await until(async () => (await countWaitingOnLocks(db().pool)) === 1);
    release();

    expect(await step).toEqual({ ok: true, value: undefined });
    expect((await fenced).rows).toEqual([{ id: jobId }]);
  });

  it("leaves a claim renewed since the listing free to beat", async () => {
    const scenario = await arrange();
    const jobId = await syncClaimed(scenario.workspaceId, new Date(Date.now() + 60_000));
    const { step, release } = await lockHeldOpen(scenario, jobId);
    const beat = await db().pool.query(
      "UPDATE job SET heartbeat_at = now() WHERE workspace_id = $1 AND id = $2",
      [scenario.workspaceId, jobId],
    );
    release();

    expect(beat.rowCount).toBe(1);
    expect(await step).toEqual({ ok: true, value: undefined });
  });
});
