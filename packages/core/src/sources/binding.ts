import { z } from "zod";

import {
  AUDIENCE_EVERYONE,
  BINDING_PUBLISHED_STATE,
  boundarySchemas,
  CONNECTOR_UPLOAD,
  FINDING_UNREVIEWED_STATE,
  INDEX_KIND,
  JOB_DONE_STATUS,
  REASONS_EMPTYING_THE_BINDING,
  SENSITIVITY_DEFAULT,
} from "@better-answers/schema";

import { visibilityAgreed } from "../access/index.ts";
import { act, declareActs, record, type DetailOf } from "../audit/index.ts";
import { openingACascadeOverHeldGroups } from "../concepts/index.ts";
import {
  admit,
  attempt,
  declareAct,
  err,
  ok,
  requireAdmin,
  ulid,
  type AdminUserPrincipal,
  type AdmittedOf,
  type InputOf,
  type Principal,
  type PrincipalRefusal,
  type RefusalOf,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import { holdsEveryGroup } from "../members/index.ts";
import { enqueueJobIn, indexRunRefused } from "../runs/index.ts";
import { putObject, type ObjectDoor } from "../store/objects/index.ts";
import {
  folded,
  withMembership,
  type Foldable,
  type Folded,
  type PostgresDoor,
  type Tx,
} from "../store/postgres/index.ts";
import {
  adminOnBinding,
  bindingNamed,
  BINDING_ID,
  BINDING_VISIBILITY,
  type ActingOnBinding,
  type PlatformOnBinding,
} from "./admin-binding.ts";
import { cascadeOverEvidence } from "./cascade.ts";
import { dpiaInputFor, type REDACTION_CATEGORIES } from "./dpia.ts";
import { raisedByTheLastRun } from "./findings.ts";
import type { SourceRefusal } from "./vocabulary.ts";

export const UPLOAD_ORIGINALS_PREFIX = "uploads/";

/** One key per attempt: a concurrent repeat that loses writes beside the committed original. */
const originalKeyOf = (bindingId: string, documentId: string): string =>
  `${UPLOAD_ORIGINALS_PREFIX}${bindingId.toLowerCase()}/${documentId.toLowerCase()}/original`;

export const UPLOAD_MEDIA_TYPES = [
  "text/markdown",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/pdf",
] as const;

export const UPLOAD_BYTE_CAP = 64 * 1024 * 1024;

const CONFIRMATIONS = [
  "lawfulBasisRecorded",
  "privacyInformationUpdated",
  "dpiaReferenced",
] as const;

type RedactionCategoryWord = (typeof REDACTION_CATEGORIES)[number]["category"];

type Pascal<Word extends string> = Word extends `${infer head}-${infer tail}`
  ? `${Capitalize<head>}${Pascal<tail>}`
  : Capitalize<Word>;

type CountField<Word extends string> = `findings${Pascal<Word>}`;

type FindingCounts = { readonly [Word in RedactionCategoryWord as CountField<Word>]: number };
type FindingCountShape = { readonly [Word in RedactionCategoryWord as CountField<Word>]: "count" };

/**
 * Spelled out: `Object.fromEntries` would lose what the two types hold, and a category the list
 * gains fails here at compile time.
 */
const FINDING_COUNT_SHAPE: FindingCountShape = {
  findingsSpecialCategory: "count",
  findingsBankDetails: "count",
  findingsGovernmentIdentifier: "count",
  findingsDateOfBirth: "count",
  findingsHomeAddress: "count",
  findingsPersonalContact: "count",
  findingsPersonName: "count",
  findingsJobTitle: "count",
};

const countOf = (found: ReadonlyMap<string, number>, category: RedactionCategoryWord): number =>
  found.get(category) ?? 0;

const countsOf = (found: ReadonlyMap<string, number>): FindingCounts => ({
  findingsSpecialCategory: countOf(found, "special-category"),
  findingsBankDetails: countOf(found, "bank-details"),
  findingsGovernmentIdentifier: countOf(found, "government-identifier"),
  findingsDateOfBirth: countOf(found, "date-of-birth"),
  findingsHomeAddress: countOf(found, "home-address"),
  findingsPersonalContact: countOf(found, "personal-contact"),
  findingsPersonName: countOf(found, "person-name"),
  findingsJobTitle: countOf(found, "job-title"),
});

const BINDING_ACTS = declareActs("sources", {
  bound: act("sources.binding.bound", {
    bindingId: "id",
    documentId: "id",
    sensitivity: "sensitivity",
    audience: "audience",
  }),

  published: act("sources.binding.published", {
    bindingId: "id",
    lawfulBasisRecorded: "flag",
    privacyInformationUpdated: "flag",
    dpiaReferenced: "flag",
    ...FINDING_COUNT_SHAPE,
    dpiaHash: "contentHash",
    sensitivity: "sensitivity",
    audience: "audience",
  }),
});

const BINDING_COLUMNS = boundarySchemas.sourceBinding.insert.shape;

const DOCUMENT_COLUMNS = boundarySchemas.sourceDocument.insert.shape;

const ASKED_VISIBILITY = BINDING_VISIBILITY.extend({
  sensitivity: BINDING_VISIBILITY.shape.sensitivity.default(SENSITIVITY_DEFAULT),
  audience: BINDING_VISIBILITY.shape.audience.default(AUDIENCE_EVERYONE),
  audienceGroups: BINDING_VISIBILITY.shape.audienceGroups.default(null),
});

export const bindUploadFields = ASKED_VISIBILITY.extend({
  bindingId: BINDING_ID,
  name: BINDING_COLUMNS.name,
  fileName: DOCUMENT_COLUMNS.sourceSystemId,
  mediaType: DOCUMENT_COLUMNS.mediaType,
  byteSize: DOCUMENT_COLUMNS.byteSize,
}).transform(({ bindingId, name, fileName, mediaType, byteSize, ...asked }, ctx) => {
  const visibility = visibilityAgreed(asked, ctx);
  return visibility === undefined
    ? z.NEVER
    : { bindingId, name, fileName, mediaType, byteSize, visibility };
});

export type BindUploadFields = z.output<typeof bindUploadFields>;

export type BindUploadInput = BindUploadFields & {
  readonly body: ReadableStream<Uint8Array>;
};

export type BindUploadRefusal =
  | PrincipalRefusal
  | SourceRefusal<"role-forbids" | "no-such-group" | "media-type-refused" | "too-large">
  | Error;

export type UploadBound = {
  readonly bindingId: string;
  readonly documentId: string;

  readonly jobId: string;
  readonly auditEventId: string;

  readonly originalKey: string;
};

const BOUND_REASON = "bound";

const INSERT_BINDING = `INSERT INTO source_binding
    (workspace_id, id, name, connector, sensitivity, audience, audience_groups)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  ON CONFLICT (workspace_id, id) DO NOTHING`;

const FIRST_OUTCOME = `SELECT d.id AS document_id, d.original_key AS original_key,
          e.id AS audit_event_id, j.id AS job_id
     FROM source_document d
     JOIN audit_event e
       ON e.workspace_id = d.workspace_id AND e.subject_id = d.binding_id AND e.act = $3
     JOIN job j
       ON j.workspace_id = d.workspace_id AND j.subject_id = d.binding_id
      AND j.kind = $4 AND j.reason = $5
    WHERE d.workspace_id = $1 AND d.binding_id = $2`;

const INSERT_DOCUMENT = `INSERT INTO source_document
    (workspace_id, id, binding_id, source_system_id, title, media_type, byte_size, original_key)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`;

const inTransaction = async <T>(
  principal: UserPrincipal,
  door: PostgresDoor,
  work: (principal: UserPrincipal, tx: Tx) => Promise<Foldable<T>>,
): Promise<Folded<T, Error>> => {
  const ran = await attempt(() => withMembership(principal, door, work));
  return ran.ok ? folded<T>(ran.value) : err(ran.error);
};

type CappedBody = {
  readonly body: ReadableStream<Uint8Array>;
  readonly passedTheCap: () => boolean;
};

const cappedAt = (body: ReadableStream<Uint8Array>): CappedBody => {
  const counted = { bytes: 0, passed: false };
  return {
    body: body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform: (chunk, controller) => {
          counted.bytes += chunk.byteLength;
          if (counted.bytes > UPLOAD_BYTE_CAP) {
            counted.passed = true;
            controller.error(new Error("sources: the upload passed the cap"));
            return;
          }
          controller.enqueue(chunk);
        },
      }),
    ),
    passedTheCap: () => counted.passed,
  };
};

const firstOutcomeOf = async (
  tx: Tx,
  workspaceId: string,
  bindingId: string,
): Promise<UploadBound | undefined> => {
  const standing = await tx.query<{
    document_id: string;
    original_key: string;
    audit_event_id: string;
    job_id: string;
  }>(FIRST_OUTCOME, [workspaceId, bindingId, BINDING_ACTS.bound.name, INDEX_KIND, BOUND_REASON]);
  const first = standing.rows[0];
  if (first === undefined) return undefined;
  return {
    bindingId,
    documentId: first.document_id,
    jobId: first.job_id,
    auditEventId: first.audit_event_id,
    originalKey: first.original_key,
  };
};

const withinUploadLimits = (
  input: BindUploadFields,
): Result<undefined, SourceRefusal<"media-type-refused" | "too-large">> => {
  if (!UPLOAD_MEDIA_TYPES.some((allowed) => allowed === input.mediaType)) {
    return err("media-type-refused");
  }
  if (input.byteSize > UPLOAD_BYTE_CAP) return err("too-large");
  return ok(undefined);
};

const everyGroupHeld = async (
  principal: UserPrincipal,
  door: PostgresDoor,
  visibility: BindUploadFields["visibility"],
): Promise<
  Result<undefined, PrincipalRefusal | SourceRefusal<"role-forbids" | "no-such-group"> | Error>
> => {
  const named = visibility.audienceGroups ?? [];
  if (named.length === 0) return ok(undefined);
  const held = await inTransaction(principal, door, (fresh, tx) =>
    holdsEveryGroup(fresh, tx, named),
  );
  if (!held.ok) return err(held.error);
  return held.value ? ok(undefined) : err("no-such-group");
};

const storeOriginal = async (
  admin: AdminUserPrincipal,
  objects: ObjectDoor,
  originalKey: string,
  body: ReadableStream<Uint8Array>,
): Promise<Result<undefined, SourceRefusal<"too-large">>> => {
  const capped = cappedAt(body);
  const put = await attempt(() => putObject(admin, objects, originalKey, capped.body));
  if (!put.ok) {
    if (capped.passedTheCap()) return err("too-large");
    throw put.error;
  }
  if (!put.value.ok) {
    throw new Error(`sources: the original's key was refused (${put.value.error})`);
  }
  return ok(undefined);
};

/**
 * Once the first bind commits, a repeat returns its outcome and reads no byte. A concurrent repeat
 * that loses the insert returns it too, its own object left to the upload sweep. `too-large`
 * answers a declared size or streamed body over the cap.
 */
export const bindUpload = async (
  principal: UserPrincipal,
  doors: { readonly postgres: PostgresDoor; readonly objects: ObjectDoor },
  input: BindUploadInput,
): Promise<Result<UploadBound, BindUploadRefusal>> => {
  const admin = requireAdmin(principal);
  if (!admin.ok) return err(admin.error);
  const { workspaceId } = admin.value;

  const { bindingId, visibility } = input;

  const limited = withinUploadLimits(input);
  if (!limited.ok) return err(limited.error);
  const held = await everyGroupHeld(principal, doors.postgres, visibility);
  if (!held.ok) return err(held.error);

  // Before a byte is read: a repeat of a committed bind would otherwise stream a copy no row names.
  const standing = await inTransaction(principal, doors.postgres, (fresh, tx) =>
    firstOutcomeOf(tx, workspaceId, bindingId),
  );
  if (!standing.ok) return err(standing.error);
  if (standing.value !== undefined) return ok(standing.value);

  const documentId = ulid();
  const auditEventId = ulid();
  const originalKey = originalKeyOf(bindingId, documentId);

  const stored = await storeOriginal(admin.value, doors.objects, originalKey, input.body);
  if (!stored.ok) return err(stored.error);

  return inTransaction(principal, doors.postgres, async (fresh, tx) => {
    const landed = await tx.query(INSERT_BINDING, [
      workspaceId,
      bindingId,
      input.name,
      CONNECTOR_UPLOAD,
      visibility.sensitivity,
      visibility.audience,
      visibility.audienceGroups,
    ]);
    if (landed.rowCount === 0) {
      const first = await firstOutcomeOf(tx, workspaceId, bindingId);
      if (first === undefined) {
        throw new Error(`sources: ${bindingId} is taken by a binding no first bind accounts for`);
      }
      return first;
    }
    await tx.query(INSERT_DOCUMENT, [
      workspaceId,
      documentId,
      bindingId,
      input.fileName,
      input.fileName,
      input.mediaType,
      input.byteSize,
      originalKey,
    ]);
    await record(fresh, tx, {
      id: auditEventId,
      act: BINDING_ACTS.bound,
      subjectId: bindingId,
      detail: {
        bindingId,
        documentId,
        sensitivity: visibility.sensitivity,
        audience: visibility.audience,
      },
    });
    const queued = await enqueueJobIn(fresh, tx, {
      workspaceId,
      kind: INDEX_KIND,
      subjectId: bindingId,
      reason: "bound",
    });
    if (!queued.ok) {
      throw indexRunRefused(queued.error);
    }
    return { bindingId, documentId, jobId: queued.value.jobId, auditEventId, originalKey };
  });
};

export const publishBindingInput = z.object({
  bindingId: BINDING_ID,

  confirmations: z.object({
    lawfulBasisRecorded: z.boolean(),
    privacyInformationUpdated: z.boolean(),
    dpiaReferenced: z.boolean(),
  } satisfies Record<(typeof CONFIRMATIONS)[number], z.ZodBoolean>),
});

/** The instant is the Clock's, never a caller's, so it travels beside the parsed fields. */
export type PublishBindingInput = z.output<typeof publishBindingInput> & {
  readonly publishedAt: Date;
};

export type PublishBindingRefusal =
  | SourceRefusal<
      | "role-forbids"
      | "no-such-binding"
      | "not-indexed"
      | "already-published"
      | "confirmation-missing"
    >
  | Error;

export type BindingPublished = {
  readonly bindingId: string;
  readonly auditEventId: string;

  readonly dpiaHash: string;
};

/**
 * The job row, not source_binding.state: the worker holds only SELECT on that table and cannot
 * write its progress there.
 */
const LATEST_INDEX_RUN = `SELECT status FROM job
    WHERE workspace_id = $1 AND kind = $2 AND subject_id = $3
    ORDER BY enqueued_at DESC, id DESC
    LIMIT 1`;

const FINDINGS_BY_CATEGORY = `SELECT f.category, count(*)::int AS found
    FROM finding f
    JOIN source_document d ON d.workspace_id = f.workspace_id AND d.id = f.document_id
   WHERE f.workspace_id = $1 AND d.binding_id = $2 AND ${raisedByTheLastRun("f", "d")}
   GROUP BY f.category`;

type BindingToPublish = {
  readonly published_at: Date | null;
  readonly sensitivity: string;
  readonly audience: string;
};

const bindingToPublish = async (
  acting: ActingOnBinding,
  tx: Tx,
): Promise<
  Result<
    BindingToPublish,
    SourceRefusal<"no-such-binding" | "already-published" | "not-indexed"> | Error
  >
> => {
  const { workspaceId, bindingId } = acting;
  const binding = await bindingNamed<BindingToPublish>(acting, tx, {
    columns: "published_at, sensitivity, audience",
    lock: "for-update",
  });
  if (!binding.ok) return err(binding.error);
  if (binding.value.published_at !== null) return err("already-published");

  const run = await attempt(() =>
    tx.query<{ status: string }>(LATEST_INDEX_RUN, [workspaceId, INDEX_KIND, bindingId]),
  );
  if (!run.ok) return err(run.error);

  if (run.value.rows[0]?.status !== JOB_DONE_STATUS) return err("not-indexed");
  return ok(binding.value);
};

type DpiaAndFindingCounts = { readonly dpiaHash: string; readonly counts: FindingCounts };

const dpiaAndFindingCounts = async (
  acting: ActingOnBinding,
  tx: Tx,
): Promise<
  Result<DpiaAndFindingCounts, SourceRefusal<"role-forbids" | "no-such-binding"> | Error>
> => {
  const { admin, workspaceId, bindingId } = acting;
  const dpia = await dpiaInputFor(admin, tx, { bindingId: bindingId });
  if (!dpia.ok) return err(dpia.error);
  const counted = await attempt(() =>
    tx.query<{ category: string; found: number }>(FINDINGS_BY_CATEGORY, [workspaceId, bindingId]),
  );
  if (!counted.ok) return err(counted.error);
  const found = new Map(counted.value.rows.map((row) => [row.category, row.found]));
  return ok({ dpiaHash: dpia.value.hash, counts: countsOf(found) });
};

type PublishedDetail = DetailOf<(typeof BINDING_ACTS)["published"]["detail"]>;

const publishAndCascade = async (
  acting: ActingOnBinding,
  tx: Tx,
  publishedAt: Date,
  detail: PublishedDetail,
): Promise<Result<string, Error>> => {
  const { admin, workspaceId, bindingId } = acting;
  const auditEventId = ulid();
  const published = await attempt(() =>
    tx.query(
      "UPDATE source_binding SET published_at = $3, state = $4 WHERE workspace_id = $1 AND id = $2",
      [workspaceId, bindingId, publishedAt, BINDING_PUBLISHED_STATE],
    ),
  );
  if (!published.ok) return err(published.error);

  await record(admin, tx, {
    id: auditEventId,
    act: BINDING_ACTS.published,
    subjectId: bindingId,
    detail,
  });
  const cascaded = await attempt(() => cascadeOverEvidence(admin, tx, { bindingId }));
  if (!cascaded.ok) return err(cascaded.error);
  return ok(auditEventId);
};

/**
 * `confirmation-missing` unless all three confirmations are true, and `not-indexed` unless the
 * latest index run is done. Stamps the binding published, writes an audit event with the DPIA hash
 * and the last run's finding count per category, and recomputes what cites its documents.
 */
export const publishBinding = async (
  principal: UserPrincipal,
  tx: Tx,
  input: PublishBindingInput,
): Promise<Result<BindingPublished, PublishBindingRefusal>> => {
  const acting = adminOnBinding(principal, input.bindingId);
  if (!acting.ok) return err(acting.error);
  const { admin, bindingId } = acting.value;

  if (!CONFIRMATIONS.every((named) => input.confirmations[named] === true)) {
    return err("confirmation-missing");
  }

  const opened = await openingACascadeOverHeldGroups(admin, tx, []);
  if (!opened.ok) return err(opened.error);

  const binding = await bindingToPublish(acting.value, tx);
  if (!binding.ok) return err(binding.error);
  const read = await dpiaAndFindingCounts(acting.value, tx);
  if (!read.ok) return err(read.error);
  const { dpiaHash, counts } = read.value;

  const published = await publishAndCascade(acting.value, tx, input.publishedAt, {
    bindingId: bindingId,
    lawfulBasisRecorded: input.confirmations.lawfulBasisRecorded,
    privacyInformationUpdated: input.confirmations.privacyInformationUpdated,
    dpiaReferenced: input.confirmations.dpiaReferenced,
    ...counts,
    dpiaHash,
    sensitivity: binding.value.sensitivity,
    audience: binding.value.audience,
  });
  if (!published.ok) return err(published.error);
  return ok({ bindingId: bindingId, auditEventId: published.value, dpiaHash });
};

export const reprocessBindingInput = z.object({
  workspaceId: boundarySchemas.workspace.select.shape.id,
  bindingId: BINDING_ID,

  reason: z.enum(REASONS_EMPTYING_THE_BINDING),
});

export const reprocessBindingAct = declareAct({
  admits: { role: "Admin", purposes: ["erasure"] },
  input: reprocessBindingInput,
  refuses: ["role-forbids", "no-such-binding"],
  effect: "write",
});

export type ReprocessBindingInput = InputOf<typeof reprocessBindingAct>;

export type ReprocessBindingRefusal = SourceRefusal<RefusalOf<typeof reprocessBindingAct>> | Error;

export type BindingReprocessed = {
  readonly bindingId: string;

  readonly jobId: string;

  readonly chunks: number;

  readonly findings: number;
};

const actingOn = (
  admittedAs: AdmittedOf<typeof reprocessBindingAct>,
  input: ReprocessBindingInput,
): Result<ActingOnBinding | PlatformOnBinding, SourceRefusal<"no-such-binding">> => {
  const { bindingId } = input;
  const acting: ActingOnBinding | PlatformOnBinding =
    admittedAs.kind === "user"
      ? { admin: admittedAs, workspaceId: admittedAs.workspaceId, bindingId }
      : { platform: admittedAs, workspaceId: input.workspaceId, bindingId };
  // A person acts where its membership was proved, so a workspace it names otherwise holds none of
  // its bindings.
  if (acting.workspaceId !== input.workspaceId) return err("no-such-binding");
  return ok(acting);
};

type Emptied = Pick<BindingReprocessed, "chunks" | "findings">;

const emptyTheBinding = async (
  acting: ActingOnBinding | PlatformOnBinding,
  tx: Tx,
): Promise<Result<Emptied, Error>> => {
  const { workspaceId, bindingId } = acting;
  const wiped = await attempt(() =>
    tx.query(`DELETE FROM "index".chunk WHERE workspace_id = $1 AND binding_id = $2`, [
      workspaceId,
      bindingId,
    ]),
  );
  if (!wiped.ok) return err(wiped.error);

  const raised = await attempt(() =>
    tx.query(
      `DELETE FROM finding
        WHERE workspace_id = $1
          AND review_state = $3 AND restored_at IS NULL
          AND document_id IN (SELECT id FROM source_document
                               WHERE workspace_id = $1 AND binding_id = $2)`,
      [workspaceId, bindingId, FINDING_UNREVIEWED_STATE],
    ),
  );
  if (!raised.ok) return err(raised.error);
  return ok({ chunks: wiped.value.rowCount ?? 0, findings: raised.value.rowCount ?? 0 });
};

/**
 * Queues an index run, then deletes the binding's chunks and its unreviewed, unrestored findings;
 * `chunks` and `findings` count the rows deleted. A person acts only in its own workspace, and any
 * other is `no-such-binding`.
 */
export const reprocessBinding = async (
  principal: Principal,
  tx: Tx,
  input: ReprocessBindingInput,
): Promise<Result<BindingReprocessed, ReprocessBindingRefusal>> => {
  const admitted = admit(reprocessBindingAct, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const acting = actingOn(admitted.value, input);
  if (!acting.ok) return err(acting.error);
  const { workspaceId, bindingId } = acting.value;

  const standing = await bindingNamed(acting.value, tx, { columns: "1", lock: "for-update" });
  if (!standing.ok) return err(standing.error);

  const queued = await enqueueJobIn(admitted.value, tx, {
    workspaceId,
    kind: INDEX_KIND,
    subjectId: bindingId,
    reason: input.reason,
  });
  if (!queued.ok) {
    throw indexRunRefused(queued.error);
  }
  const emptied = await emptyTheBinding(acting.value, tx);
  if (!emptied.ok) return err(emptied.error);
  return ok({ bindingId: bindingId, jobId: queued.value.jobId, ...emptied.value });
};
