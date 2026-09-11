import { testData } from "@better-answers/schema/testing";
import { describe, expect, it } from "vitest";

import type { PlatformPrincipal } from "../src/kernel/index.ts";
import { bundleHealth, enqueueJob, enqueueJobIn, JOB_IS_OVER, jobById } from "../src/runs/index.ts";
import { withMembership, withScope, type Tx } from "../src/store/postgres/index.ts";
import { abortTheTransaction } from "./suite-postgres.ts";
import { suiteWithBundles, type Scenario } from "./workspace-with-bundle.ts";

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

/** The nightly audit as cron queues it — the platform's road — and the id a person reads back. */
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

/**
 * A nightly audit that found nothing, in the shape the worker writes (`ParseFindings.as_row`
 * in `apps/worker`): the count, and the four lists a bundle is healthy only when all are
 * empty.
 */
const NOTHING_FOUND = {
  checked: 1,
  mismatched: [],
  unparsed: [],
  missing_row: [],
  missing_file: [],
} as const;

/**
 * An outcome written past the boundary — as the worker's finish function would take it, the
 * column being JSONB and the function the database's — onto a job the factory finished.
 */
const outcomeWrittenRaw = async (workspaceId: string, jobId: string, outcome: unknown) => {
  await db().pool.query("UPDATE job SET outcome = $3 WHERE workspace_id = $1 AND id = $2", [
    workspaceId,
    jobId,
    JSON.stringify(outcome),
  ]);
};

/** A nightly audit over three files that found nothing, finished at this instant. */
const foundNothingOn = (workspaceId: string, at: string) =>
  finishedAudit(workspaceId, { ...NOTHING_FOUND, checked: 3 }, new Date(at));

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

/**
 * The binding an `index` run is about. The queue carries a subject as text and nothing more
 * — what a kind is about differs by kind, and a binding's existence is `source_binding`'s to
 * enforce and not the queue's — so a literal here is the whole arrangement.
 */
const BINDING = "01K4Q9F3V8YXP7R2M6ZKWC3TDS";

/** A second binding, so the run key can be shown to be one per subject and not one per kind. */
const ANOTHER_BINDING = "01K4Q9F3V8YXP7R2M6ZKWC3TDT";

/** The upload act's job: this binding through the seam and into the index, because it was bound. */
const boundJob = (workspaceId: string) =>
  ({ workspaceId, kind: "index", subjectId: BINDING, reason: "bound" }) as const;

/**
 * One transaction opened the way an act opens one, with the enqueue riding inside it — the
 * shape every caller of `enqueueJobIn` has (the upload act, S0's erasure routine) reduced to
 * the part these tests are about. The platform's road, because the role gate has its own test
 * below and these are about the transaction.
 */
const actOf = <T>(scenario: Scenario, work: (tx: Tx) => Promise<T>): Promise<T> =>
  withScope(graphMaintenance, scenario.postgres, scenario.workspaceId, (tx) => work(tx));

/** Every job row this workspace holds, in the columns the enqueue decides. */
const jobsIn = async (workspaceId: string) =>
  (
    await db().pool.query(
      "SELECT id, kind, subject_id, reason, status FROM job WHERE workspace_id = $1 ORDER BY enqueued_at",
      [workspaceId],
    )
  ).rows;

describe("an act that lands its rows and its job in one transaction", () => {
  it("rolls back with the act it rode in, so nothing is queued for work that never landed", async () => {
    // `[TEST8]`: the act's transaction is the thing under test, so its outcome is asserted
    // beside the rows. The enqueue landed its row and the act failed afterwards, which is the
    // whole reason this form takes a transaction rather than a door.
    const scenario = await arrange();

    const act = actOf(scenario, async (tx) => {
      const enqueued = await enqueueJobIn(graphMaintenance, tx, boundJob(scenario.workspaceId));
      // The act's own next statement fails from here on — an upload whose object write, ledger
      // row or document row went wrong after the job was queued.
      await abortTheTransaction(tx);
      return enqueued;
    });

    await expect(act).rejects.toThrow("the transaction did not commit");
    expect(await jobsIn(scenario.workspaceId)).toEqual([]);
  });

  it("answers the first job's id for a binding already queued, and the act it rides in still commits", async () => {
    // The run key's answer. A bare INSERT would have raised on the partial unique index and
    // aborted the caller's transaction, which is the one thing an enqueue riding inside
    // somebody else's act must never do — so the act goes on after the second enqueue and the
    // test asserts that it did.
    const scenario = await arrange();
    const first = await actOf(scenario, (tx) =>
      enqueueJobIn(graphMaintenance, tx, boundJob(scenario.workspaceId)),
    );
    if (!first.ok) throw new Error(`the job was not queued: ${String(first.error)}`);

    const second = await actOf(scenario, async (tx) => {
      const answered = await enqueueJobIn(graphMaintenance, tx, {
        ...boundJob(scenario.workspaceId),
        reason: "rule-change",
      });
      await tx.query("SELECT 1");
      return answered;
    });

    expect(second).toEqual({ ok: true, value: { jobId: first.value.jobId } });
    // One row, still carrying the reason the first enqueue gave it: the second changed nothing.
    expect(await jobsIn(scenario.workspaceId)).toEqual([
      {
        id: first.value.jobId,
        kind: "index",
        subject_id: BINDING,
        reason: "bound",
        status: "queued",
      },
    ]);
  });

  it("queues a second binding on its own, because the run key is one per subject", async () => {
    // The other half of the pair above (`[TEST7]`): the rule is one queued run per binding,
    // never one per kind, so a workspace binding two files queues two jobs.
    const scenario = await arrange();

    const first = await actOf(scenario, (tx) =>
      enqueueJobIn(graphMaintenance, tx, boundJob(scenario.workspaceId)),
    );
    const other = await actOf(scenario, (tx) =>
      enqueueJobIn(graphMaintenance, tx, {
        ...boundJob(scenario.workspaceId),
        subjectId: ANOTHER_BINDING,
      }),
    );

    if (!first.ok || !other.ok) throw new Error("a job was not queued");
    expect(await jobsIn(scenario.workspaceId)).toEqual([
      {
        id: first.value.jobId,
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
    "refuses %s with the word malformed, rather than aborting the act with a CHECK",
    async (_what, asked) => {
      // Each is a row one of the descriptor-derived CHECKs would refuse. The word is what the
      // caller can act on; the aborted transaction is what it gets if this arm is missed, and
      // it would take the act's own rows down with it.
      const scenario = await arrange();

      const refused = await actOf(scenario, (tx) =>
        enqueueJobIn(graphMaintenance, tx, {
          workspaceId: scenario.workspaceId,
          ...asked,
        } as Parameters<typeof enqueueJobIn>[2]),
      );

      expect(refused).toEqual({ ok: false, error: "malformed" });
      expect(await jobsIn(scenario.workspaceId)).toEqual([]);
    },
  );

  it("gates the enqueue on the role the kind's descriptor names", async () => {
    // Per kind and read off the descriptor, never hard-coded: every kind today names Admin,
    // and S8's Editor write is a record changed rather than this arm rewritten.
    const scenario = await arrange();

    const editor = await withMembership(scenario.editor, scenario.postgres, (_fresh, tx) =>
      enqueueJobIn(scenario.editor, tx, boundJob(scenario.workspaceId)),
    );
    const admin = await withMembership(scenario.admin, scenario.postgres, (_fresh, tx) =>
      enqueueJobIn(scenario.admin, tx, boundJob(scenario.workspaceId)),
    );

    expect(editor).toEqual({ ok: true, value: { ok: false, error: "role-forbids" } });
    expect(admin.ok && admin.value.ok).toBe(true);
    expect((await jobsIn(scenario.workspaceId)).length).toBe(1);
  });

  it("is what the door form calls, so a job queued through the door lands with its subject", async () => {
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

  it("hands back the store's failure, never the value, for a finished job whose outcome is not the shape the queue agreement admits", async () => {
    // The finish functions take any JSONB; the boundary is what holds the agreement, and a
    // nested outcome — the one place content could hide — is refused on the way out.
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

  it("answers a person polling in their own workspace, whichever road queued the job", async () => {
    // The two roads meet on one row: cron queues the audit as the platform, and the
    // workspace's own Admin reads that job back through their membership. A `--wait` on the
    // ops command and a person asking after the same job are one read, not two.
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

  it("refuses a Viewer and an Editor, because an audit's outcome names the bundle's files", async () => {
    // `bundleHealth`'s gate, for the material it has it for: a finished audit's outcome lists
    // every file whose hash disagreed with its row, and no other read in this slice shows a
    // member below Admin the shape of the bundle. Scope does not decide it — every member of
    // the workspace passes the policy — so the role is checked in front of the read.
    const scenario = await arrange();
    const asking = { workspaceId: scenario.workspaceId, jobId: await auditQueuedByCron(scenario) };

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

  it("says healthy when the last audit found nothing in any of its four lists", async () => {
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
    "says mismatched over %s — every finding is the repository and the index disagreeing",
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
    "says mismatched, never healthy, over an outcome it cannot read as clean — %s",
    async (_shape, outcome) => {
      // The fail-closed reading of "I cannot tell" is the one that puts a person in front
      // of the bundle; a worker that wrote a shape this cannot read is itself the finding.
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

  it("reads the latest finished audit, so a mismatch put right stops being one", async () => {
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
