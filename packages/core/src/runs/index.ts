import { z } from "zod";

import {
  boundarySchemas,
  FULL_REBUILD_KIND,
  INDEX_KIND,
  INDEX_REASONS,
  JOB_CLAIMED_STATUS,
  JOB_DONE_STATUS,
  JOB_KIND_DESCRIPTORS,
  JOB_QUEUED_STATUS,
  NIGHTLY_AUDIT_KIND,
  REASONS_EMPTYING_THE_CONNECTED_SOURCE,
  REBUILD_REASONS,
  ROLES,
  type JOB_KINDS,
  type JOB_REASONS,
  type JOB_STATUSES,
  type JobKindDescriptor,
} from "@better-answers/schema";

import {
  admit,
  ADMIN_ALONE,
  attempt,
  declareAction,
  err,
  EVERY_PURPOSE,
  ok,
  ulid,
  type AdminUserPrincipal,
  type InputOf,
  type KernelRefusal,
  type Principal,
  type PrincipalRefusal,
  type RefusalOf,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import {
  folded,
  withMember,
  withScope,
  type Foldable,
  type Folded,
  type PostgresDoor,
  type Tx,
} from "../store/postgres/index.ts";

export { RUN_REFUSALS } from "./vocabulary.ts";

type JobKind = (typeof JOB_KINDS)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];
export type RebuildReason = (typeof REBUILD_REASONS)[number];

export type IndexReason = (typeof INDEX_REASONS)[number];

export const WIPE_REASON = "wiped" satisfies IndexReason;

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
  work: (tx: Tx) => Promise<Foldable<T>>,
): Promise<Folded<T, Error>> => {
  if (principal.kind === "platform") {
    const ran = await attempt(() => withScope(principal, door, workspaceId, (tx) => work(tx)));
    return ran.ok ? folded<T>(ok(ran.value)) : err(ran.error);
  }
  const held = await attempt(() => withMember(principal, door, (_fresh, tx) => work(tx)));
  return held.ok ? folded<T>(held.value) : err(held.error);
};

const descriptorOf = (kind: string): JobKindDescriptor | undefined =>
  JOB_KIND_DESCRIPTORS.find((descriptor) => descriptor.kind === kind);

const JOB_COLUMNS = boundarySchemas.job.insert.shape;

const WORKSPACE_ID = JOB_COLUMNS.workspaceId;

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

export const enqueueJobAction = declareAction({
  /** The level is the kind's own, and a kind with no descriptor is left to the highest role. */
  admits: (input: z.output<typeof enqueueJobInput>) => ({
    role: descriptorOf(input.kind)?.enqueuedBy ?? ROLES[0],
    purposes: EVERY_PURPOSE,
  }),
  input: enqueueJobInput,
  refuses: ["role-forbids", "malformed"],
});

export type EnqueueJobInput = InputOf<typeof enqueueJobAction>;

export type EnqueueJobRefusal = KernelRefusal<RefusalOf<typeof enqueueJobAction>>;

const ENQUEUE = `WITH inserted AS (
    INSERT INTO job (workspace_id, id, kind, subject_id, reason)
    VALUES ($1, $2, $3, $4::text, $5::text)
    ON CONFLICT (workspace_id, kind, subject_id) WHERE status = '${JOB_QUEUED_STATUS}' DO NOTHING
    RETURNING id
  ), taken AS (
    UPDATE job SET reason = $5::text
     WHERE workspace_id = $1 AND kind = $3 AND subject_id = $4::text
       AND status = '${JOB_QUEUED_STATUS}'
       AND $5::text = ANY($6::text[]) AND reason <> ALL($6::text[])
       AND NOT EXISTS (SELECT 1 FROM inserted)
    RETURNING id
  )
  SELECT id FROM inserted
  UNION ALL
  SELECT id FROM job
   WHERE workspace_id = $1 AND kind = $3 AND subject_id = $4::text
     AND status = '${JOB_QUEUED_STATUS}' AND NOT EXISTS (SELECT 1 FROM inserted)`;

export const syncRefused = (refusal: EnqueueJobRefusal): Error =>
  new Error(`runs: the sync was refused (${refusal})`);

const fitsTheKind = (
  descriptor: JobKindDescriptor,
  subjectId: string | null,
  reason: string | null,
): boolean => {
  const namesASubject = subjectId !== null && subjectId.trim() !== "";
  if (descriptor.namesASubject !== namesASubject) return false;
  if (descriptor.reasons.length > 0 !== (reason !== null)) return false;
  return reason === null || descriptor.reasons.includes(reason);
};

type JobInsert = Pick<
  z.output<typeof boundarySchemas.job.insert>,
  "id" | "kind" | "subjectId" | "reason"
>;

const jobInsertOf = (
  descriptor: JobKindDescriptor,
  input: EnqueueJobInput,
): JobInsert | undefined => {
  const subjectId = "subjectId" in input ? input.subjectId : null;
  const reason = "reason" in input ? input.reason : null;
  if (!fitsTheKind(descriptor, subjectId, reason)) return undefined;
  const parsed = boundarySchemas.job.insert
    .pick({ id: true, kind: true, subjectId: true, reason: true })
    .safeParse({ id: ulid(), kind: input.kind, subjectId, reason });
  return parsed.success ? parsed.data : undefined;
};

const landJob = async (tx: Tx, workspaceId: string, job: JobInsert): Promise<string> => {
  const landed = await tx.query<{ id: string }>(ENQUEUE, [
    workspaceId,
    job.id,
    job.kind,
    job.subjectId ?? null,
    job.reason ?? null,
    REASONS_EMPTYING_THE_CONNECTED_SOURCE,
  ]);
  const answered = landed.rows[0]?.id;
  if (answered === undefined) {
    throw new Error("another action queued this subject while this one was enqueueing it");
  }
  return answered;
};

/**
 * Reuses a job already queued for the subject and answers its id; a reason that empties the
 * connected source replaces a queued reason that does not. Refuses `malformed` for input its kind does not
 * take, or another workspace's. Rejects when another action queues the subject meanwhile.
 */
export const enqueueJobIn = async (
  principal: Principal,
  tx: Tx,
  input: EnqueueJobInput,
): Promise<Result<{ readonly jobId: string }, EnqueueJobRefusal>> => {
  const descriptor = descriptorOf(input.kind);
  if (descriptor === undefined) return err("malformed");

  /** Both ways into the enqueue pass here, so the gate stands where the door has not yet opened. */
  const admitted = admit(enqueueJobAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  if (principal.kind !== "platform" && input.workspaceId !== principal.workspaceId) {
    return err("malformed");
  }

  const job = jobInsertOf(descriptor, input);
  if (job === undefined) return err("malformed");
  return ok({ jobId: await landJob(tx, input.workspaceId, job) });
};

/** As `enqueueJobIn`, in a transaction of its own. */
export const enqueueJob = async (
  principal: Principal,
  door: PostgresDoor,
  input: EnqueueJobInput,
): Promise<Result<{ readonly jobId: string }, EnqueueJobRefusal | PrincipalRefusal | Error>> =>
  inWorkspace(principal, door, input.workspaceId, (tx) => enqueueJobIn(principal, tx, input));

/** An Admin, or the platform acting for any purpose. */
const ADMIN_OR_THE_PLATFORM = { role: "Admin", purposes: EVERY_PURPOSE } as const;

type JobByIdInput = { readonly workspaceId: string; readonly jobId: string };

const jobByIdAction = declareAction({
  admits: ADMIN_OR_THE_PLATFORM,
  input: z.custom<JobByIdInput>(),
  refuses: ["role-forbids", "no-such-job"],
});

export type JobByIdRefusal = RefusalOf<typeof jobByIdAction> | PrincipalRefusal;

/** A job in another workspace answers `no-such-job`, as a missing one does. */
export const jobById = async (
  principal: Principal,
  door: PostgresDoor,
  input: JobByIdInput,
): Promise<Result<JobState, JobByIdRefusal | Error>> => {
  const admitted = admit(jobByIdAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  if (principal.kind !== "platform" && input.workspaceId !== principal.workspaceId) {
    return err("no-such-job");
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

/** The outcome of the connected source's newest `done` sync; null when there is none or it has none. */
export const latestIndexOutcomeIn = async (
  admin: AdminUserPrincipal,
  tx: Tx,
  input: { readonly connectedSourceId: string },
): Promise<Result<JobOutcome | null, Error>> => {
  const read = await attempt(() =>
    tx.query<OutcomeRow>(
      `SELECT outcome FROM job
        WHERE workspace_id = $1 AND kind = $2 AND subject_id = $3 AND status = $4
        ORDER BY finished_at DESC, id DESC LIMIT 1`,
      [admin.workspaceId, INDEX_KIND, input.connectedSourceId, JOB_DONE_STATUS],
    ),
  );
  if (!read.ok) return err(read.error);
  const row = read.value.rows[0];
  return row === undefined ? ok(null) : outcomeOf(row.outcome);
};

/** The index job outcome's key naming each document whose stored sensitivity the sync changed. */
export const SENSITIVITY_MOVED_KEY = "sensitivity_moved";

export type SyncMoved =
  | { readonly kind: "whole-source" }
  | { readonly kind: "documents"; readonly documentIds: readonly string[] };

const WHOLE_SOURCE: SyncMoved = { kind: "whole-source" };

const DOCUMENT_IDS = z.array(z.string().min(1));

const movedByTheKey = (outcome: JobOutcome | null): SyncMoved => {
  if (outcome === null || !Object.hasOwn(outcome, SENSITIVITY_MOVED_KEY)) return WHOLE_SOURCE;
  const named = DOCUMENT_IDS.safeParse(outcome[SENSITIVITY_MOVED_KEY]);
  return named.success ? { kind: "documents", documentIds: named.data } : WHOLE_SOURCE;
};

/**
 * Only a done first attempt's key is trusted: a retry finds nothing left to move, and a failed,
 * poisoned or lapsed sync may have moved documents it never named.
 */
export const whatTheSyncMoved = (sync: {
  readonly status: JobStatus;
  readonly attempts: number;
  readonly outcome: JobOutcome | null;
}): SyncMoved =>
  sync.status === JOB_DONE_STATUS && sync.attempts <= 1
    ? movedByTheKey(sync.outcome)
    : WHOLE_SOURCE;

/** `endedAt` is a lapsed claim's lease expiry, and every other sync's `finished_at`. */
export type EndedSync = {
  readonly jobId: string;
  readonly connectedSourceId: string;
  readonly status: JobStatus;
  readonly attempts: number;
  readonly endedAt: Date;
  readonly moved: SyncMoved;
};

export type SyncScan =
  | { readonly kind: "ended-since"; readonly at: Date }
  | { readonly kind: "newest-per-source" };

type EndedSyncRow = {
  readonly id: string;
  readonly subject_id: string;
  readonly status: JobStatus;
  readonly attempts: number;
  readonly outcome: OutcomeColumn;
  readonly ended_at: Date;
};

const LAPSED = `status = '${JOB_CLAIMED_STATUS}' AND lease_expires_at < now()`;

const ENDED_SINCE = `SELECT id, subject_id, status, attempts, outcome,
         COALESCE(finished_at, lease_expires_at) AS ended_at
    FROM job
   WHERE workspace_id = $1 AND kind = $2
     AND (status = ANY($3::text[]) OR (${LAPSED}))
     AND COALESCE(finished_at, lease_expires_at) >= $4
   ORDER BY ended_at, id`;

const NEWEST_PER_SOURCE = `SELECT * FROM (
    SELECT DISTINCT ON (subject_id) id, subject_id, status, attempts, outcome,
           finished_at AS ended_at
      FROM job
     WHERE workspace_id = $1 AND kind = $2 AND status = ANY($3::text[])
     ORDER BY subject_id, finished_at DESC, id DESC
  ) AS newest
  UNION ALL
  SELECT id, subject_id, status, attempts, outcome, lease_expires_at AS ended_at
    FROM job
   WHERE workspace_id = $1 AND kind = $2 AND ${LAPSED}
   ORDER BY ended_at, id`;

const scanOf = (workspaceId: string, scan: SyncScan): readonly [string, readonly unknown[]] => {
  const shared = [workspaceId, INDEX_KIND, JOB_IS_OVER];
  return scan.kind === "ended-since"
    ? [ENDED_SINCE, [...shared, scan.at]]
    : [NEWEST_PER_SOURCE, shared];
};

const endedSyncOf = (row: EndedSyncRow): EndedSync => {
  const outcome = outcomeOf(row.outcome);
  return {
    jobId: row.id,
    connectedSourceId: row.subject_id,
    status: row.status,
    attempts: row.attempts,
    endedAt: row.ended_at,
    moved: whatTheSyncMoved({
      status: row.status,
      attempts: row.attempts,
      outcome: outcome.ok ? outcome.value : null,
    }),
  };
};

type EndedSyncsInput = { readonly workspaceId: string; readonly scan: SyncScan };

const endedSyncsAction = declareAction({
  admits: ADMIN_OR_THE_PLATFORM,
  input: z.custom<EndedSyncsInput>(),
  refuses: ["role-forbids"],
});

/**
 * Index jobs that ended, or whose claim lapsed, oldest first; never a queued job or a live claim.
 * `newest-per-source` answers each connected source's newest ended sync and every lapsed claim.
 */
export const endedSyncs = async (
  principal: Principal,
  door: PostgresDoor,
  input: EndedSyncsInput,
): Promise<
  Result<readonly EndedSync[], RefusalOf<typeof endedSyncsAction> | PrincipalRefusal | Error>
> => {
  const reader = admit(endedSyncsAction, principal, input);
  if (!reader.ok) return err(reader.error);

  const [statement, values] = scanOf(input.workspaceId, input.scan);
  const read = await inWorkspace(principal, door, input.workspaceId, (tx) =>
    tx.query<EndedSyncRow>(statement, [...values]),
  );
  return read.ok ? ok(read.value.rows.map(endedSyncOf)) : err(read.error);
};

type LockSyncInput = {
  readonly workspaceId: string;
  readonly jobId: string;
  readonly attempts: number;
};

const lockSyncAction = declareAction({
  admits: ADMIN_OR_THE_PLATFORM,
  input: z.custom<LockSyncInput>(),
  refuses: ["role-forbids"],
});

/** Locks the sync's job row until `tx` ends, so a claimant whose lease lapsed cannot write after it. */
export const lockSyncIn = async (
  principal: Principal,
  tx: Tx,
  input: LockSyncInput,
): Promise<Result<void, RefusalOf<typeof lockSyncAction> | Error>> => {
  const locker = admit(lockSyncAction, principal, input);
  if (!locker.ok) return err(locker.error);

  // A claim renewed or taken again since the listing is live: locking it would stall its heartbeat.
  const locked = await attempt(() =>
    tx.query(
      `SELECT 1 FROM job
        WHERE workspace_id = $1 AND id = $2 AND status = 'claimed' AND attempts = $3
          AND lease_expires_at < clock_timestamp()
          FOR UPDATE`,
      [input.workspaceId, input.jobId, input.attempts],
    ),
  );
  return locked.ok ? ok(undefined) : err(locked.error);
};

export const runsOfSubjectInput = z.object({ subjectId: SUBJECT_ID });

export type RunsOfSubjectInput = z.output<typeof runsOfSubjectInput>;

const runsOfSubjectAction = declareAction({
  admits: ADMIN_ALONE,
  input: runsOfSubjectInput,
  refuses: ["role-forbids"],
});

/**
 * Its outcome stays on the job row: a sync's outcome locates each overridden span, the
 * address of withheld text.
 */
export type SubjectRun = {
  readonly jobId: string;
  readonly kind: JobKind;
  readonly reason: (typeof JOB_REASONS)[number] | null;
  readonly status: JobStatus;
  readonly attempts: number;
  readonly enqueuedAt: string;

  readonly finishedAt: string | null;
};

type SubjectRunRow = Omit<SubjectRun, "enqueuedAt" | "finishedAt" | "jobId"> & {
  readonly id: string;
  readonly subject_id: string;
  readonly enqueued_at: Date;
  readonly finished_at: Date | null;
};

const SUBJECT_RUN_COLUMNS =
  "id, subject_id, kind, reason, status, attempts, enqueued_at, finished_at";

const NEWEST_FIRST = "enqueued_at DESC, id DESC";

const subjectRunsOf = (
  rows: readonly SubjectRunRow[],
): ReadonlyArray<readonly [string, SubjectRun]> =>
  rows.map(({ id, subject_id, enqueued_at, finished_at, ...run }) => [
    subject_id,
    {
      jobId: id,
      ...run,
      enqueuedAt: enqueued_at.toISOString(),
      finishedAt: finished_at?.toISOString() ?? null,
    },
  ]);

/** Newest first. */
export const runsOfSubject = async (
  principal: UserPrincipal,
  tx: Tx,
  input: RunsOfSubjectInput,
): Promise<Result<readonly SubjectRun[], RefusalOf<typeof runsOfSubjectAction> | Error>> => {
  const admin = admit(runsOfSubjectAction, principal, input);
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
  return ok(subjectRunsOf(read.value.rows).map(([, subjectRun]) => subjectRun));
};

/** Each subject's newest job; a subject with no job is absent from the map. */
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
  return ok(new Map(subjectRunsOf(read.value.rows)));
};

const AUDIT_FINDINGS = ["mismatched", "unparsed", "missing_row", "missing_file"] as const;

const bundleHealthAction = declareAction({
  admits: ADMIN_ALONE,
  input: z.object({}),
  refuses: ["role-forbids"],
});

/** Read from the newest `done` nightly audit; an outcome that cannot be read is `mismatched`. */
export const bundleHealth = async (
  principal: UserPrincipal,
  door: PostgresDoor,
): Promise<
  Result<BundleHealth, RefusalOf<typeof bundleHealthAction> | PrincipalRefusal | Error>
> => {
  const admin = admit(bundleHealthAction, principal, {});
  if (!admin.ok) return err(admin.error);

  const read = await attempt(() =>
    withMember(principal, door, async (fresh, tx) =>
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
