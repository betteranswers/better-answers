import {
  boundarySchemas,
  FULL_REBUILD_KIND,
  INDEX_KIND,
  INDEX_REASONS,
  JOB_DONE_STATUS,
  JOB_KIND_DESCRIPTORS,
  JOB_QUEUED_STATUS,
  NIGHTLY_AUDIT_KIND,
  REBUILD_REASONS,
  ROLES,
  type JOB_KINDS,
  type JOB_REASONS,
  type JOB_STATUSES,
  type JobKindDescriptor,
} from "@better-answers/schema";
import { z } from "zod";

import {
  admit,
  attempt,
  declareAct,
  err,
  EVERY_PURPOSE,
  ok,
  requireAdmin,
  ulid,
  type AdminUserPrincipal,
  type InputOf,
  type KernelRefusal,
  type Principal,
  type PrincipalRefusal,
  type RefusalOf,
  type Result,
  type RoleRefusal,
  type UserPrincipal,
} from "../kernel/index.ts";
import {
  opened,
  withMembership,
  withScope,
  type Opened,
  type PostgresDoor,
  type Tx,
} from "../store/postgres/index.ts";

export type JobKind = (typeof JOB_KINDS)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];
export type RebuildReason = (typeof REBUILD_REASONS)[number];

export type IndexReason = (typeof INDEX_REASONS)[number];

const WIPE_REASON = "wiped" satisfies IndexReason;

export type BundleHealth = "healthy" | "mismatched" | "never-audited";

export type JobState = {
  readonly jobId: string;
  readonly kind: JobKind;
  readonly reason: RebuildReason | null;
  readonly status: JobStatus;

  readonly attempts: number;

  readonly outcome: JobOutcome | null;
};

const OUTCOME = boundarySchemas.job.select.shape.outcome;
export type JobOutcome = NonNullable<z.infer<typeof OUTCOME>>;

type OutcomeColumn = z.input<typeof OUTCOME>;

const outcomeOf = (raw: OutcomeColumn): Result<JobOutcome | null, Error> => {
  const parsed = OUTCOME.safeParse(raw);
  return parsed.success
    ? ok(parsed.data)
    : err(new Error("the job's outcome is not the shape the queue agreement admits"));
};

export const JOB_IS_OVER: readonly JobStatus[] = ["done", "failed", "poisoned"];

type JobRow = {
  readonly id: string;
  readonly kind: JobKind;
  readonly reason: RebuildReason | null;
  readonly status: JobStatus;
  readonly attempts: number;
  readonly outcome: OutcomeColumn;
};

const inWorkspace = async <T>(
  principal: Principal,
  door: PostgresDoor,
  workspaceId: string,
  work: (tx: Tx) => Promise<T>,
): Promise<Opened<T, Error>> => {
  if (principal.kind === "platform") {
    const ran = await attempt(() => withScope(principal, door, workspaceId, (tx) => work(tx)));
    return ran.ok ? opened(ran.value) : err(ran.error);
  }
  const held = await attempt(() => withMembership(principal, door, (_fresh, tx) => work(tx)));
  return held.ok ? held.value : err(held.error);
};

const descriptorOf = (kind: string): JobKindDescriptor | undefined =>
  JOB_KIND_DESCRIPTORS.find((descriptor) => descriptor.kind === kind);

const JOB_COLUMNS = boundarySchemas.job.insert.shape;

// Steps reach the enqueue holding a workspace id off a row, so this one column crosses unbranded.
const WORKSPACE_ID: z.ZodType<string, string> = JOB_COLUMNS.workspaceId;

const SUBJECT_ID = JOB_COLUMNS.subjectId.unwrap();

export const enqueueJobInput = z.discriminatedUnion("kind", [
  z.object({ workspaceId: WORKSPACE_ID, kind: z.literal(NIGHTLY_AUDIT_KIND) }),
  z.object({
    workspaceId: WORKSPACE_ID,
    kind: z.literal(FULL_REBUILD_KIND),
    reason: z.enum(REBUILD_REASONS),
  }),
  z.object({
    workspaceId: WORKSPACE_ID,
    kind: z.literal(INDEX_KIND),
    subjectId: SUBJECT_ID,
    reason: z.enum(INDEX_REASONS),
  }),
]);

export const enqueueJobAct = declareAct({
  // The level is the kind's own, and a kind with no descriptor is left to the highest role.
  admits: (input: z.output<typeof enqueueJobInput>) => ({
    role: descriptorOf(input.kind)?.enqueuedBy ?? ROLES[0],
    purposes: EVERY_PURPOSE,
  }),
  input: enqueueJobInput,
  refuses: ["role-forbids", "malformed"],
  effect: "write",
});

export type EnqueueJobInput = InputOf<typeof enqueueJobAct>;

export type EnqueueJobRefusal = KernelRefusal<RefusalOf<typeof enqueueJobAct>>;

const ENQUEUE = `WITH inserted AS (
    INSERT INTO job (workspace_id, id, kind, subject_id, reason)
    VALUES ($1, $2, $3, $4::text, $5::text)
    ON CONFLICT (workspace_id, kind, subject_id) WHERE status = '${JOB_QUEUED_STATUS}' DO NOTHING
    RETURNING id
  ), taken AS (
    UPDATE job SET reason = $5::text
     WHERE workspace_id = $1 AND kind = $3 AND subject_id = $4::text
       AND status = '${JOB_QUEUED_STATUS}' AND $5::text = '${WIPE_REASON}' AND reason <> '${WIPE_REASON}'
       AND NOT EXISTS (SELECT 1 FROM inserted)
    RETURNING id
  )
  SELECT id FROM inserted
  UNION ALL
  SELECT id FROM job
   WHERE workspace_id = $1 AND kind = $3 AND subject_id = $4::text
     AND status = '${JOB_QUEUED_STATUS}' AND NOT EXISTS (SELECT 1 FROM inserted)`;

export const indexRunRefused = (refusal: EnqueueJobRefusal): Error =>
  new Error(`runs: the index run was refused (${refusal})`);

export const enqueueJobIn = async (
  principal: Principal,
  tx: Tx,
  input: EnqueueJobInput,
): Promise<Result<{ readonly jobId: string }, EnqueueJobRefusal>> => {
  const descriptor = descriptorOf(input.kind);
  if (descriptor === undefined) return err("malformed");

  // Both ways into the enqueue pass here, so the gate stands where the door has not yet opened.
  const admitted = admit(enqueueJobAct, principal, input);
  if (!admitted.ok) return err(admitted.error);
  if (principal.kind !== "platform" && input.workspaceId !== principal.workspaceId) {
    return err("malformed");
  }

  const subjectId = "subjectId" in input ? input.subjectId : null;
  const reason = "reason" in input ? input.reason : null;

  const namesASubject = subjectId !== null && subjectId.trim() !== "";
  if (descriptor.namesASubject !== namesASubject) return err("malformed");
  if (descriptor.reasons.length > 0 !== (reason !== null)) return err("malformed");
  if (reason !== null && !descriptor.reasons.includes(reason)) return err("malformed");

  const jobId = ulid();
  const parsed = boundarySchemas.job.insert
    .pick({ workspaceId: true, id: true, kind: true, subjectId: true, reason: true })
    .safeParse({ workspaceId: input.workspaceId, id: jobId, kind: input.kind, subjectId, reason });

  if (!parsed.success) return err("malformed");

  const landed = await tx.query<{ id: string }>(ENQUEUE, [
    parsed.data.workspaceId,
    parsed.data.id,
    parsed.data.kind,
    parsed.data.subjectId ?? null,
    parsed.data.reason ?? null,
  ]);
  const answered = landed.rows[0]?.id;
  if (answered === undefined) {
    throw new Error("another act queued this subject while this one was enqueueing it");
  }
  return ok({ jobId: answered });
};

export const enqueueJob = async (
  principal: Principal,
  door: PostgresDoor,
  input: EnqueueJobInput,
): Promise<Result<{ readonly jobId: string }, EnqueueJobRefusal | PrincipalRefusal | Error>> =>
  inWorkspace(principal, door, input.workspaceId, (tx) => enqueueJobIn(principal, tx, input));

export const jobById = async (
  principal: Principal,
  door: PostgresDoor,
  input: { readonly workspaceId: string; readonly jobId: string },
): Promise<Result<JobState, "no-such-job" | RoleRefusal | PrincipalRefusal | Error>> => {
  if (principal.kind !== "platform") {
    const admin = requireAdmin(principal);
    if (!admin.ok) return err(admin.error);
    if (input.workspaceId !== principal.workspaceId) return err("no-such-job");
  }
  const read = await inWorkspace(principal, door, input.workspaceId, (tx) =>
    tx.query<JobRow>(
      "SELECT id, kind, reason, status, attempts, outcome FROM job WHERE workspace_id = $1 AND id = $2",
      [input.workspaceId, input.jobId],
    ),
  );
  if (!read.ok) return err(read.error);

  const row = read.value.rows[0];
  if (row === undefined) return err("no-such-job");
  const outcome = outcomeOf(row.outcome);
  if (!outcome.ok) return err(outcome.error);
  return ok({
    jobId: row.id,
    kind: row.kind,
    reason: row.reason,
    status: row.status,
    attempts: row.attempts,
    outcome: outcome.value,
  });
};

type OutcomeRow = { readonly outcome: OutcomeColumn };

export const latestIndexOutcomeIn = async (
  principal: UserPrincipal,
  tx: Tx,
  input: { readonly bindingId: string },
): Promise<Result<JobOutcome | null, RoleRefusal | Error>> => {
  const admin = requireAdmin(principal);
  if (!admin.ok) return err(admin.error);

  const read = await attempt(() =>
    tx.query<OutcomeRow>(
      `SELECT outcome FROM job
        WHERE workspace_id = $1 AND kind = $2 AND subject_id = $3 AND status = $4
        ORDER BY finished_at DESC, id DESC LIMIT 1`,
      [admin.value.workspaceId, INDEX_KIND, input.bindingId, JOB_DONE_STATUS],
    ),
  );
  if (!read.ok) return err(read.error);
  const row = read.value.rows[0];
  return row === undefined ? ok(null) : outcomeOf(row.outcome);
};

export const runsOfSubjectInput = z.object({ subjectId: SUBJECT_ID });

export type RunsOfSubjectInput = z.output<typeof runsOfSubjectInput>;

export type SubjectRun = {
  readonly jobId: string;
  readonly kind: JobKind;
  readonly reason: (typeof JOB_REASONS)[number] | null;
  readonly status: JobStatus;
  readonly attempts: number;
  readonly enqueuedAt: string;

  readonly finishedAt: string | null;
  readonly outcome: JobOutcome | null;
};

type SubjectRunRow = Omit<SubjectRun, "enqueuedAt" | "finishedAt" | "jobId" | "outcome"> & {
  readonly id: string;
  readonly subject_id: string;
  readonly enqueued_at: Date;
  readonly finished_at: Date | null;
  readonly outcome: OutcomeColumn;
};

const SUBJECT_RUN_COLUMNS =
  "id, subject_id, kind, reason, status, attempts, enqueued_at, finished_at, outcome";

const NEWEST_FIRST = "enqueued_at DESC, id DESC";

const subjectRunsOf = (
  rows: readonly SubjectRunRow[],
): Result<ReadonlyArray<readonly [string, SubjectRun]>, Error> => {
  const runs: Array<readonly [string, SubjectRun]> = [];
  for (const { id, subject_id, enqueued_at, finished_at, outcome, ...run } of rows) {
    const found = outcomeOf(outcome);
    if (!found.ok) return err(found.error);
    runs.push([
      subject_id,
      {
        jobId: id,
        ...run,
        enqueuedAt: enqueued_at.toISOString(),
        finishedAt: finished_at?.toISOString() ?? null,
        outcome: found.value,
      },
    ]);
  }
  return ok(runs);
};

export const runsOfSubject = async (
  principal: UserPrincipal,
  tx: Tx,
  input: RunsOfSubjectInput,
): Promise<Result<readonly SubjectRun[], RoleRefusal | Error>> => {
  const admin = requireAdmin(principal);
  if (!admin.ok) return err(admin.error);

  const read = await attempt(() =>
    tx.query<SubjectRunRow>(
      `SELECT ${SUBJECT_RUN_COLUMNS} FROM job
        WHERE workspace_id = $1 AND subject_id = $2
        ORDER BY ${NEWEST_FIRST}`,
      [admin.value.workspaceId, input.subjectId],
    ),
  );
  if (!read.ok) return err(read.error);
  const runs = subjectRunsOf(read.value.rows);
  return runs.ok ? ok(runs.value.map(([, run]) => run)) : runs;
};

export const latestRunsOf = async (
  admin: AdminUserPrincipal,
  tx: Tx,
  input: { readonly subjectIds: readonly string[] },
): Promise<Result<ReadonlyMap<string, SubjectRun>, Error>> => {
  const read = await attempt(() =>
    tx.query<SubjectRunRow>(
      `SELECT DISTINCT ON (subject_id) ${SUBJECT_RUN_COLUMNS} FROM job
        WHERE workspace_id = $1 AND subject_id = ANY($2::text[])
        ORDER BY subject_id, ${NEWEST_FIRST}`,
      [admin.workspaceId, input.subjectIds],
    ),
  );
  if (!read.ok) return err(read.error);
  const runs = subjectRunsOf(read.value.rows);
  return runs.ok ? ok(new Map(runs.value)) : runs;
};

const AUDIT_FINDINGS = ["mismatched", "unparsed", "missing_row", "missing_file"] as const;

export const bundleHealth = async (
  principal: UserPrincipal,
  door: PostgresDoor,
): Promise<Result<BundleHealth, RoleRefusal | PrincipalRefusal | Error>> => {
  const admin = requireAdmin(principal);
  if (!admin.ok) return err(admin.error);

  const read = await attempt(() =>
    withMembership(principal, door, async (fresh, tx) =>
      tx.query<OutcomeRow>(
        `SELECT outcome FROM job
          WHERE workspace_id = $1 AND kind = $2 AND status = 'done'
          ORDER BY finished_at DESC LIMIT 1`,
        [fresh.workspaceId, NIGHTLY_AUDIT_KIND],
      ),
    ),
  );
  if (!read.ok) return err(read.error);
  if (!read.value.ok) return err(read.value.error);

  const row = read.value.value.rows[0];
  if (row === undefined) return ok("never-audited");
  const outcome = outcomeOf(row.outcome);
  if (!outcome.ok || outcome.value === null) return ok("mismatched");
  const findings = outcome.value;
  const clean = AUDIT_FINDINGS.every((finding) => {
    const found = findings[finding];
    return Array.isArray(found) && found.length === 0;
  });
  return ok(clean ? "healthy" : "mismatched");
};
