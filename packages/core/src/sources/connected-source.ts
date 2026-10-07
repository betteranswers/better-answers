import { z } from "zod";

import {
  AUDIENCE_EVERYONE,
  CONNECTED_SOURCE_PUBLISHED_STATE,
  boundarySchemas,
  CONNECTOR_UPLOAD,
  FINDING_UNREVIEWED_STATE,
  INDEX_KIND,
  JOB_DONE_STATUS,
  REASONS_EMPTYING_THE_CONNECTED_SOURCE,
  SENSITIVITY_DEFAULT,
} from "@better-answers/schema";

import { visibilityAgreed } from "../access/index.ts";
import { act, declareActs, record, STORED_DETAIL_KEYS, type DetailOf } from "../audit/index.ts";
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
  adminOnConnectedSource,
  connectedSourceNamed,
  CONNECTED_SOURCE_ID,
  CONNECTED_SOURCE_VISIBILITY,
  type ActingOnConnectedSource,
  type PlatformOnConnectedSource,
} from "./admin-connected-source.ts";
import { cascadeOverEvidence } from "./cascade.ts";
import { dpiaInputFor, type REDACTION_CATEGORIES } from "./dpia.ts";
import { raisedByTheLastRun } from "./findings.ts";
import type { SourceRefusal } from "./vocabulary.ts";

export const UPLOAD_ORIGINALS_PREFIX = "uploads/";

/** One key per attempt: a concurrent repeat that loses writes beside the committed original. */
const originalKeyOf = (connectedSourceId: string, documentId: string): string =>
  `${UPLOAD_ORIGINALS_PREFIX}${connectedSourceId.toLowerCase()}/${documentId.toLowerCase()}/original`;

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

const CONNECTED_SOURCE_ACTS = declareActs("sources", {
  bound: act("sources.binding.bound", {
    [STORED_DETAIL_KEYS.connectedSourceId]: "id",
    documentId: "id",
    sensitivity: "sensitivity",
    audience: "audience",
  }),

  published: act("sources.binding.published", {
    [STORED_DETAIL_KEYS.connectedSourceId]: "id",
    lawfulBasisRecorded: "flag",
    privacyInformationUpdated: "flag",
    dpiaReferenced: "flag",
    ...FINDING_COUNT_SHAPE,
    dpiaHash: "contentHash",
    sensitivity: "sensitivity",
    audience: "audience",
  }),
});

const CONNECTED_SOURCE_COLUMNS = boundarySchemas.connectedSource.insert.shape;

const DOCUMENT_COLUMNS = boundarySchemas.sourceDocument.insert.shape;

const ASKED_VISIBILITY = CONNECTED_SOURCE_VISIBILITY.extend({
  sensitivity: CONNECTED_SOURCE_VISIBILITY.shape.sensitivity.default(SENSITIVITY_DEFAULT),
  audience: CONNECTED_SOURCE_VISIBILITY.shape.audience.default(AUDIENCE_EVERYONE),
  audienceGroups: CONNECTED_SOURCE_VISIBILITY.shape.audienceGroups.default(null),
});

export const connectUploadFields = ASKED_VISIBILITY.extend({
  connectedSourceId: CONNECTED_SOURCE_ID,
  name: CONNECTED_SOURCE_COLUMNS.name,
  fileName: DOCUMENT_COLUMNS.sourceSystemId,
  mediaType: DOCUMENT_COLUMNS.mediaType,
  byteSize: DOCUMENT_COLUMNS.byteSize,
}).transform(({ connectedSourceId, name, fileName, mediaType, byteSize, ...asked }, ctx) => {
  const visibility = visibilityAgreed(asked, ctx);
  return visibility === undefined
    ? z.NEVER
    : { connectedSourceId, name, fileName, mediaType, byteSize, visibility };
});

export type ConnectUploadFields = z.output<typeof connectUploadFields>;

export type ConnectUploadInput = ConnectUploadFields & {
  readonly body: ReadableStream<Uint8Array>;
};

export type ConnectUploadRefusal =
  | PrincipalRefusal
  | SourceRefusal<"role-forbids" | "no-such-group" | "media-type-refused" | "too-large">
  | Error;

type ConnectUploadDoors = { readonly postgres: PostgresDoor; readonly objects: ObjectDoor };

export type UploadBound = {
  readonly connectedSourceId: string;
  readonly documentId: string;

  readonly jobId: string;
  readonly auditEventId: string;

  readonly originalKey: string;
};

const CONNECTED_REASON = "connected";

const INSERT_CONNECTED_SOURCE = `INSERT INTO connected_source
    (workspace_id, id, name, connector, sensitivity, audience, audience_groups)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  ON CONFLICT (workspace_id, id) DO NOTHING`;

const FIRST_OUTCOME = `SELECT d.id AS document_id, d.original_key AS original_key,
          e.id AS audit_event_id, j.id AS job_id
     FROM source_document d
     JOIN audit_event e
       ON e.workspace_id = d.workspace_id AND e.subject_id = d.connected_source_id AND e.act = $3
     JOIN job j
       ON j.workspace_id = d.workspace_id AND j.subject_id = d.connected_source_id
      AND j.kind = $4 AND j.reason = $5
    WHERE d.workspace_id = $1 AND d.connected_source_id = $2`;

const INSERT_DOCUMENT = `INSERT INTO source_document
    (workspace_id, id, connected_source_id, source_system_id, title, media_type, byte_size, original_key)
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
  readonly bytesStreamed: () => number;
};

const cappedAt = (body: ReadableStream<Uint8Array>): CappedBody => {
  const counted = { bytes: 0, passed: false };
  return {
    body: body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform: (passage, controller) => {
          counted.bytes += passage.byteLength;
          if (counted.bytes > UPLOAD_BYTE_CAP) {
            counted.passed = true;
            controller.error(new Error("sources: the upload passed the cap"));
            return;
          }
          controller.enqueue(passage);
        },
      }),
    ),
    passedTheCap: () => counted.passed,
    bytesStreamed: () => counted.bytes,
  };
};

const firstOutcomeOf = async (
  tx: Tx,
  workspaceId: string,
  connectedSourceId: string,
): Promise<UploadBound | undefined> => {
  const standing = await tx.query<{
    document_id: string;
    original_key: string;
    audit_event_id: string;
    job_id: string;
  }>(FIRST_OUTCOME, [
    workspaceId,
    connectedSourceId,
    CONNECTED_SOURCE_ACTS.bound.name,
    INDEX_KIND,
    CONNECTED_REASON,
  ]);
  const first = standing.rows[0];
  if (first === undefined) return undefined;
  return {
    connectedSourceId,
    documentId: first.document_id,
    jobId: first.job_id,
    auditEventId: first.audit_event_id,
    originalKey: first.original_key,
  };
};

const withinUploadLimits = (
  input: ConnectUploadFields,
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
  visibility: ConnectUploadFields["visibility"],
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
): Promise<Result<number, SourceRefusal<"too-large">>> => {
  const capped = cappedAt(body);
  const put = await attempt(() => putObject(admin, objects, originalKey, capped.body));
  if (!put.ok) {
    if (capped.passedTheCap()) return err("too-large");
    throw put.error;
  }
  if (!put.value.ok) {
    throw new Error(`sources: the original's key was refused (${put.value.error})`);
  }
  return ok(capped.bytesStreamed());
};

/**
 * Once the first connect commits, a repeat returns its outcome and reads no byte. A concurrent repeat
 * that loses the insert returns it too, its own object left to the upload sweep. `too-large`
 * answers a declared size or streamed body over the cap; the document records the size streamed.
 */
export const connectUpload = async (
  principal: UserPrincipal,
  doors: ConnectUploadDoors,
  input: ConnectUploadInput,
): Promise<Result<UploadBound, ConnectUploadRefusal>> => {
  const admin = requireAdmin(principal);
  if (!admin.ok) return err(admin.error);
  const { workspaceId } = admin.value;

  const { connectedSourceId, visibility } = input;

  const limited = withinUploadLimits(input);
  if (!limited.ok) return err(limited.error);
  const held = await everyGroupHeld(principal, doors.postgres, visibility);
  if (!held.ok) return err(held.error);

  // Before a byte is read: a repeat of a committed connect would otherwise stream a copy no row names.
  const standing = await inTransaction(principal, doors.postgres, (fresh, tx) =>
    firstOutcomeOf(tx, workspaceId, connectedSourceId),
  );
  if (!standing.ok) return err(standing.error);
  if (standing.value !== undefined) return ok(standing.value);

  const documentId = ulid();
  const auditEventId = ulid();
  const originalKey = originalKeyOf(connectedSourceId, documentId);

  const stored = await storeOriginal(admin.value, doors.objects, originalKey, input.body);
  if (!stored.ok) return err(stored.error);
  const bytesStreamed = stored.value;

  return inTransaction(principal, doors.postgres, async (fresh, tx) => {
    const landed = await tx.query(INSERT_CONNECTED_SOURCE, [
      workspaceId,
      connectedSourceId,
      input.name,
      CONNECTOR_UPLOAD,
      visibility.sensitivity,
      visibility.audience,
      visibility.audienceGroups,
    ]);
    if (landed.rowCount === 0) {
      const first = await firstOutcomeOf(tx, workspaceId, connectedSourceId);
      if (first === undefined) {
        throw new Error(
          `sources: ${connectedSourceId} is taken by a connected source no first connect accounts for`,
        );
      }
      return first;
    }
    await tx.query(INSERT_DOCUMENT, [
      workspaceId,
      documentId,
      connectedSourceId,
      input.fileName,
      input.fileName,
      input.mediaType,
      bytesStreamed,
      originalKey,
    ]);
    await record(fresh, tx, {
      id: auditEventId,
      act: CONNECTED_SOURCE_ACTS.bound,
      subjectId: connectedSourceId,
      detail: {
        [STORED_DETAIL_KEYS.connectedSourceId]: connectedSourceId,
        documentId,
        sensitivity: visibility.sensitivity,
        audience: visibility.audience,
      },
    });
    const queued = await enqueueJobIn(fresh, tx, {
      workspaceId,
      kind: INDEX_KIND,
      subjectId: connectedSourceId,
      reason: CONNECTED_REASON,
    });
    if (!queued.ok) {
      throw indexRunRefused(queued.error);
    }
    return { connectedSourceId, documentId, jobId: queued.value.jobId, auditEventId, originalKey };
  });
};

export const publishConnectedSourceInput = z.object({
  connectedSourceId: CONNECTED_SOURCE_ID,

  confirmations: z.object({
    lawfulBasisRecorded: z.boolean(),
    privacyInformationUpdated: z.boolean(),
    dpiaReferenced: z.boolean(),
  } satisfies Record<(typeof CONFIRMATIONS)[number], z.ZodBoolean>),
});

/** The instant is the Clock's, never a caller's, so it travels beside the parsed fields. */
export type PublishConnectedSourceInput = z.output<typeof publishConnectedSourceInput> & {
  readonly publishedAt: Date;
};

export type PublishConnectedSourceRefusal =
  | SourceRefusal<
      | "role-forbids"
      | "no-such-binding"
      | "not-indexed"
      | "already-published"
      | "confirmation-missing"
    >
  | Error;

export type ConnectedSourcePublished = {
  readonly connectedSourceId: string;
  readonly auditEventId: string;

  readonly dpiaHash: string;
};

/**
 * The job row, not connected_source.state: the worker holds only SELECT on that table and cannot
 * write its progress there.
 */
const LATEST_INDEX_RUN = `SELECT status FROM job
    WHERE workspace_id = $1 AND kind = $2 AND subject_id = $3
    ORDER BY enqueued_at DESC, id DESC
    LIMIT 1`;

const FINDINGS_BY_CATEGORY = `SELECT f.category, count(*)::int AS found
    FROM finding f
    JOIN source_document d ON d.workspace_id = f.workspace_id AND d.id = f.document_id
   WHERE f.workspace_id = $1 AND d.connected_source_id = $2 AND ${raisedByTheLastRun("f", "d")}
   GROUP BY f.category`;

type ConnectedSourceToPublish = {
  readonly published_at: Date | null;
  readonly sensitivity: string;
  readonly audience: string;
};

const connectedSourceToPublish = async (
  acting: ActingOnConnectedSource,
  tx: Tx,
): Promise<
  Result<
    ConnectedSourceToPublish,
    SourceRefusal<"no-such-binding" | "already-published" | "not-indexed"> | Error
  >
> => {
  const { workspaceId, connectedSourceId } = acting;
  const connectedSource = await connectedSourceNamed<ConnectedSourceToPublish>(acting, tx, {
    columns: "published_at, sensitivity, audience",
    lock: "for-update",
  });
  if (!connectedSource.ok) return err(connectedSource.error);
  if (connectedSource.value.published_at !== null) return err("already-published");

  const run = await attempt(() =>
    tx.query<{ status: string }>(LATEST_INDEX_RUN, [workspaceId, INDEX_KIND, connectedSourceId]),
  );
  if (!run.ok) return err(run.error);

  if (run.value.rows[0]?.status !== JOB_DONE_STATUS) return err("not-indexed");
  return ok(connectedSource.value);
};

type DpiaAndFindingCounts = { readonly dpiaHash: string; readonly counts: FindingCounts };

const dpiaAndFindingCounts = async (
  acting: ActingOnConnectedSource,
  tx: Tx,
): Promise<
  Result<DpiaAndFindingCounts, SourceRefusal<"role-forbids" | "no-such-binding"> | Error>
> => {
  const { admin, workspaceId, connectedSourceId } = acting;
  const dpia = await dpiaInputFor(admin, tx, { connectedSourceId: connectedSourceId });
  if (!dpia.ok) return err(dpia.error);
  const counted = await attempt(() =>
    tx.query<{ category: string; found: number }>(FINDINGS_BY_CATEGORY, [
      workspaceId,
      connectedSourceId,
    ]),
  );
  if (!counted.ok) return err(counted.error);
  const found = new Map(counted.value.rows.map((row) => [row.category, row.found]));
  return ok({ dpiaHash: dpia.value.hash, counts: countsOf(found) });
};

type PublishedDetail = DetailOf<(typeof CONNECTED_SOURCE_ACTS)["published"]["detail"]>;

const publishAndCascade = async (
  acting: ActingOnConnectedSource,
  tx: Tx,
  publishedAt: Date,
  detail: PublishedDetail,
): Promise<Result<string, Error>> => {
  const { admin, workspaceId, connectedSourceId } = acting;
  const auditEventId = ulid();
  const published = await attempt(() =>
    tx.query(
      "UPDATE connected_source SET published_at = $3, state = $4 WHERE workspace_id = $1 AND id = $2",
      [workspaceId, connectedSourceId, publishedAt, CONNECTED_SOURCE_PUBLISHED_STATE],
    ),
  );
  if (!published.ok) return err(published.error);

  await record(admin, tx, {
    id: auditEventId,
    act: CONNECTED_SOURCE_ACTS.published,
    subjectId: connectedSourceId,
    detail,
  });
  const cascaded = await attempt(() => cascadeOverEvidence(admin, tx, { connectedSourceId }));
  if (!cascaded.ok) return err(cascaded.error);
  return ok(auditEventId);
};

/**
 * `confirmation-missing` unless all three confirmations are true, and `not-indexed` unless the
 * latest index run is done. Stamps the connected source published, writes an audit event with the DPIA hash
 * and the last run's finding count per category, and recomputes what cites its documents.
 */
export const publishConnectedSource = async (
  principal: UserPrincipal,
  tx: Tx,
  input: PublishConnectedSourceInput,
): Promise<Result<ConnectedSourcePublished, PublishConnectedSourceRefusal>> => {
  const acting = adminOnConnectedSource(principal, input.connectedSourceId);
  if (!acting.ok) return err(acting.error);
  const { admin, connectedSourceId } = acting.value;

  if (!CONFIRMATIONS.every((named) => input.confirmations[named] === true)) {
    return err("confirmation-missing");
  }

  const opened = await openingACascadeOverHeldGroups(admin, tx, []);
  if (!opened.ok) return err(opened.error);

  const connectedSource = await connectedSourceToPublish(acting.value, tx);
  if (!connectedSource.ok) return err(connectedSource.error);
  const read = await dpiaAndFindingCounts(acting.value, tx);
  if (!read.ok) return err(read.error);
  const { dpiaHash, counts } = read.value;

  const published = await publishAndCascade(acting.value, tx, input.publishedAt, {
    [STORED_DETAIL_KEYS.connectedSourceId]: connectedSourceId,
    lawfulBasisRecorded: input.confirmations.lawfulBasisRecorded,
    privacyInformationUpdated: input.confirmations.privacyInformationUpdated,
    dpiaReferenced: input.confirmations.dpiaReferenced,
    ...counts,
    dpiaHash,
    sensitivity: connectedSource.value.sensitivity,
    audience: connectedSource.value.audience,
  });
  if (!published.ok) return err(published.error);
  return ok({ connectedSourceId: connectedSourceId, auditEventId: published.value, dpiaHash });
};

export const reprocessConnectedSourceInput = z.object({
  workspaceId: boundarySchemas.workspace.select.shape.id,
  connectedSourceId: CONNECTED_SOURCE_ID,

  reason: z.enum(REASONS_EMPTYING_THE_CONNECTED_SOURCE),
});

export const reprocessConnectedSourceAct = declareAct({
  admits: { role: "Admin", purposes: ["erasure"] },
  input: reprocessConnectedSourceInput,
  refuses: ["role-forbids", "no-such-binding"],
  effect: "write",
});

export type ReprocessConnectedSourceInput = InputOf<typeof reprocessConnectedSourceAct>;

export type ReprocessConnectedSourceRefusal =
  | SourceRefusal<RefusalOf<typeof reprocessConnectedSourceAct>>
  | Error;

export type ConnectedSourceReprocessed = {
  readonly connectedSourceId: string;

  readonly jobId: string;

  readonly passages: number;

  readonly findings: number;
};

const actingOn = (
  admittedAs: AdmittedOf<typeof reprocessConnectedSourceAct>,
  input: ReprocessConnectedSourceInput,
): Result<
  ActingOnConnectedSource | PlatformOnConnectedSource,
  SourceRefusal<"no-such-binding">
> => {
  const { connectedSourceId } = input;
  const acting: ActingOnConnectedSource | PlatformOnConnectedSource =
    admittedAs.kind === "user"
      ? { admin: admittedAs, workspaceId: admittedAs.workspaceId, connectedSourceId }
      : { platform: admittedAs, workspaceId: input.workspaceId, connectedSourceId };
  // A person acts where its membership was proved, so a workspace it names otherwise holds none of
  // its connected sources.
  if (acting.workspaceId !== input.workspaceId) return err("no-such-binding");
  return ok(acting);
};

type Emptied = Pick<ConnectedSourceReprocessed, "passages" | "findings">;

const emptyTheConnectedSource = async (
  acting: ActingOnConnectedSource | PlatformOnConnectedSource,
  tx: Tx,
): Promise<Result<Emptied, Error>> => {
  const { workspaceId, connectedSourceId } = acting;
  const wiped = await attempt(() =>
    tx.query(`DELETE FROM "index".passage WHERE workspace_id = $1 AND connected_source_id = $2`, [
      workspaceId,
      connectedSourceId,
    ]),
  );
  if (!wiped.ok) return err(wiped.error);

  const raised = await attempt(() =>
    tx.query(
      `DELETE FROM finding
        WHERE workspace_id = $1
          AND review_state = $3 AND restored_at IS NULL
          AND document_id IN (SELECT id FROM source_document
                               WHERE workspace_id = $1 AND connected_source_id = $2)`,
      [workspaceId, connectedSourceId, FINDING_UNREVIEWED_STATE],
    ),
  );
  if (!raised.ok) return err(raised.error);
  return ok({ passages: wiped.value.rowCount ?? 0, findings: raised.value.rowCount ?? 0 });
};

/**
 * Queues an index run, then deletes the connected source's passages and its unreviewed, unrestored findings;
 * `passages` and `findings` count the rows deleted. A person acts only in its own workspace, and any
 * other is `no-such-binding`.
 */
export const reprocessConnectedSource = async (
  principal: Principal,
  tx: Tx,
  input: ReprocessConnectedSourceInput,
): Promise<Result<ConnectedSourceReprocessed, ReprocessConnectedSourceRefusal>> => {
  const admitted = admit(reprocessConnectedSourceAct, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const acting = actingOn(admitted.value, input);
  if (!acting.ok) return err(acting.error);
  const { workspaceId, connectedSourceId } = acting.value;

  const standing = await connectedSourceNamed(acting.value, tx, {
    columns: "1",
    lock: "for-update",
  });
  if (!standing.ok) return err(standing.error);

  const queued = await enqueueJobIn(admitted.value, tx, {
    workspaceId,
    kind: INDEX_KIND,
    subjectId: connectedSourceId,
    reason: input.reason,
  });
  if (!queued.ok) {
    throw indexRunRefused(queued.error);
  }
  const emptied = await emptyTheConnectedSource(acting.value, tx);
  if (!emptied.ok) return err(emptied.error);
  return ok({ connectedSourceId: connectedSourceId, jobId: queued.value.jobId, ...emptied.value });
};
