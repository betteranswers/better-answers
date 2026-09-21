import {
  boundarySchemas,
  INDEX_KIND,
  JOB_DONE_STATUS,
  JOB_KIND_DESCRIPTORS,
  JOB_QUEUED_STATUS,
  NIGHTLY_AUDIT_KIND,
  ROLES,
  type FULL_REBUILD_KIND,
  type INDEX_REASONS,
  type JOB_KINDS,
  type JOB_STATUSES,
  type JobKindDescriptor,
  type REBUILD_REASONS,
} from "@better-answers/schema";
import type { z } from "zod";

import {
  attempt,
  err,
  ok,
  requireAdmin,
  ulid,
  type Principal,
  type PrincipalRefusal,
  type Result,
  type Role,
  type RoleRefusal,
  type UserPrincipal,
} from "../kernel/index.ts";
import { withMembership, withScope, type PostgresDoor, type Tx } from "../store/postgres/index.ts";

export type JobKind = (typeof JOB_KINDS)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];
export type RebuildReason = (typeof REBUILD_REASONS)[number];

export type IndexReason = (typeof INDEX_REASONS)[number];

const WIPE_REASON = "wiped" satisfies IndexReason;

export type EnqueuedJob =
  | { readonly kind: typeof NIGHTLY_AUDIT_KIND }
  | { readonly kind: typeof FULL_REBUILD_KIND; readonly reason: RebuildReason }
  | {
      readonly kind: typeof INDEX_KIND;

      readonly subjectId: string;
      readonly reason: IndexReason;
    };

export type BundleHealth = "healthy" | "mismatched" | "never-audited";

export type EnqueueJobInput = { readonly workspaceId: string } & EnqueuedJob;

export type EnqueueJobRefusal = RoleRefusal | "malformed";

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
): Promise<Result<T, PrincipalRefusal | Error>> => {
  if (principal.kind === "platform") {
    return attempt(() => withScope(principal, door, workspaceId, (tx) => work(tx)));
  }
  const held = await attempt(() => withMembership(principal, door, (_fresh, tx) => work(tx)));
  if (!held.ok) return err(held.error);
  if (!held.value.ok) return err(held.value.error);
  return ok(held.value.value);
};

const descriptorOf = (kind: string): JobKindDescriptor | undefined =>
  JOB_KIND_DESCRIPTORS.find((descriptor) => descriptor.kind === kind);

const reaches = (held: Role, named: Role): boolean => ROLES.indexOf(held) <= ROLES.indexOf(named);

const admittedToEnqueue = (
  principal: Principal,
  descriptor: JobKindDescriptor,
  workspaceId: string,
): Result<undefined, EnqueueJobRefusal> => {
  if (principal.kind === "platform") return ok(undefined);
  if (!reaches(principal.role, descriptor.enqueuedBy)) return err("role-forbids");

  if (workspaceId !== principal.workspaceId) return err("malformed");
  return ok(undefined);
};

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

export const enqueueJobIn = async (
  principal: Principal,
  tx: Tx,
  input: EnqueueJobInput,
): Promise<Result<{ readonly jobId: string }, EnqueueJobRefusal>> => {
  const descriptor = descriptorOf(input.kind);
  if (descriptor === undefined) return err("malformed");

  const admitted = admittedToEnqueue(principal, descriptor, input.workspaceId);
  if (!admitted.ok) return err(admitted.error);

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
): Promise<Result<{ readonly jobId: string }, EnqueueJobRefusal | PrincipalRefusal | Error>> => {
  const enqueued = await inWorkspace(principal, door, input.workspaceId, (tx) =>
    enqueueJobIn(principal, tx, input),
  );
  return enqueued.ok ? enqueued.value : err(enqueued.error);
};

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
