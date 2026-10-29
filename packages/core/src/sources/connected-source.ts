import { z } from "zod";

import {
  AUDIENCE_EVERYONE,
  boundarySchemas,
  CONNECTOR_UPLOAD,
  FINDING_UNREVIEWED_STATE,
  INDEX_KIND,
  REASONS_EMPTYING_THE_CONNECTED_SOURCE,
  SENSITIVITY_DEFAULT,
} from "@better-answers/schema";

import { visibilityAgreed } from "../access/index.ts";
import { action, declareActions, record, STORED_DETAIL_KEYS } from "../audit/index.ts";
import {
  admit,
  ADMIN_ALONE,
  attempt,
  declareAction,
  err,
  ok,
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
import { enqueueJobIn, syncRefused } from "../runs/index.ts";
import { putObject, type ObjectDoor } from "../store/objects/index.ts";
import {
  folded,
  withMember,
  type Foldable,
  type Folded,
  type PostgresDoor,
  type Tx,
} from "../store/postgres/index.ts";
import {
  connectedSourceNamed,
  CONNECTED_SOURCE_ID,
  CONNECTED_SOURCE_VISIBILITY,
  type ActingOnConnectedSource,
  type PlatformOnConnectedSource,
} from "./admin-connected-source.ts";
import type { REDACTION_CATEGORIES } from "./dpia.ts";
import type { SourceRefusal } from "./vocabulary.ts";

export const UPLOAD_ORIGINALS_PREFIX = "uploads/";

const originalKeyOf = (connectedSourceId: string, documentId: string): string =>
  `${UPLOAD_ORIGINALS_PREFIX}${connectedSourceId.toLowerCase()}/${documentId.toLowerCase()}/original`;

export const UPLOAD_MEDIA_TYPES = [
  "text/markdown",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/pdf",
] as const;

export const UPLOAD_BYTE_CAP = 64 * 1024 * 1024;

export type RedactionCategoryWord = (typeof REDACTION_CATEGORIES)[number]["category"];

type Pascal<Word extends string> = Word extends `${infer head}-${infer tail}`
  ? `${Capitalize<head>}${Pascal<tail>}`
  : Capitalize<Word>;

type CountField<Word extends string> = `findings${Pascal<Word>}`;

export type FindingCounts = {
  readonly [Word in RedactionCategoryWord as CountField<Word>]: number;
};

type FindingCountShape = { readonly [Word in RedactionCategoryWord as CountField<Word>]: "count" };

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

export const CONNECTED_SOURCE_ACTIONS = declareActions("sources", {
  bound: action("sources.binding.bound", {
    [STORED_DETAIL_KEYS.connectedSourceId]: "id",
    documentId: "id",
    sensitivity: "sensitivity",
    audience: "audience",
  }),

  published: action("sources.binding.published", {
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

const connectUploadAction = declareAction({
  admits: ADMIN_ALONE,
  input: connectUploadFields,
  refuses: ["role-forbids", "no-such-group", "media-type-refused", "too-large"],
});

export type ConnectUploadRefusal =
  | PrincipalRefusal
  | SourceRefusal<RefusalOf<typeof connectUploadAction>>
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
       ON e.workspace_id = d.workspace_id AND e.subject_id = d.connected_source_id AND e.action = $3
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
  const ran = await attempt(() => withMember(principal, door, work));
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
    CONNECTED_SOURCE_ACTIONS.bound.name,
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
 * Once the first connect commits, a repeat returns its outcome and reads no byte. `too-large`
 * answers a declared size or streamed body over the cap.
 */
export const connectUpload = async (
  principal: UserPrincipal,
  doors: ConnectUploadDoors,
  input: ConnectUploadInput,
): Promise<Result<UploadBound, ConnectUploadRefusal>> => {
  const admin = admit(connectUploadAction, principal, input);
  if (!admin.ok) return err(admin.error);
  const { workspaceId } = admin.value;

  const { connectedSourceId, visibility } = input;

  const limited = withinUploadLimits(input);
  if (!limited.ok) return err(limited.error);
  const held = await everyGroupHeld(principal, doors.postgres, visibility);
  if (!held.ok) return err(held.error);

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
      action: CONNECTED_SOURCE_ACTIONS.bound,
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
      throw syncRefused(queued.error);
    }
    return { connectedSourceId, documentId, jobId: queued.value.jobId, auditEventId, originalKey };
  });
};

export const reprocessConnectedSourceInput = z.object({
  workspaceId: boundarySchemas.workspace.select.shape.id,
  connectedSourceId: CONNECTED_SOURCE_ID,

  reason: z.enum(REASONS_EMPTYING_THE_CONNECTED_SOURCE),
});

export const reprocessConnectedSourceAction = declareAction({
  admits: { role: "Admin", purposes: ["erasure", "reindex"] },
  input: reprocessConnectedSourceInput,
  refuses: ["role-forbids", "no-such-binding"],
});

export type ReprocessConnectedSourceInput = InputOf<typeof reprocessConnectedSourceAction>;

export type ReprocessConnectedSourceRefusal =
  | SourceRefusal<RefusalOf<typeof reprocessConnectedSourceAction>>
  | Error;

export type ConnectedSourceReprocessed = {
  readonly connectedSourceId: string;

  readonly jobId: string;

  readonly passages: number;

  readonly findings: number;
};

const actingOn = (
  admittedAs: AdmittedOf<typeof reprocessConnectedSourceAction>,
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
  if (acting.workspaceId !== input.workspaceId) return err("no-such-binding");
  return ok(acting);
};

type Emptied = Pick<ConnectedSourceReprocessed, "passages" | "findings">;

const emptyTheConnectedSource = async (
  acting: ActingOnConnectedSource | PlatformOnConnectedSource,
  tx: Tx,
): Promise<Result<Emptied>> => {
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

export const reprocessConnectedSource = async (
  principal: Principal,
  tx: Tx,
  input: ReprocessConnectedSourceInput,
): Promise<Result<ConnectedSourceReprocessed, ReprocessConnectedSourceRefusal>> => {
  const admitted = admit(reprocessConnectedSourceAction, principal, input);
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
    throw syncRefused(queued.error);
  }
  const emptied = await emptyTheConnectedSource(acting.value, tx);
  if (!emptied.ok) return err(emptied.error);
  return ok({ connectedSourceId: connectedSourceId, jobId: queued.value.jobId, ...emptied.value });
};
