import {
  AUDIENCE_EVERYONE,
  BINDING_PUBLISHED_STATE,
  boundarySchemas,
  CONNECTOR_UPLOAD,
  FINDING_UNREVIEWED_STATE,
  INDEX_KIND,
  JOB_DONE_STATUS,
  SENSITIVITY_DEFAULT,
} from "@better-answers/schema";

import { visibilityFrom } from "../access/index.ts";
import { act, declareActs, record } from "../audit/index.ts";
import {
  attempt,
  err,
  ok,
  requireAdmin,
  ulid,
  type PrincipalRefusal,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import { holdsEveryGroup } from "../members/index.ts";
import { enqueueJobIn, type IndexReason } from "../runs/index.ts";
import { putObject, type ObjectDoor } from "../store/objects/index.ts";
import { withMembership, type PostgresDoor, type Tx } from "../store/postgres/index.ts";
import { adminOnBinding, bindingNamed } from "./admin-binding.ts";
import { dpiaInputFor, REDACTION_CATEGORIES } from "./dpia.ts";
import { raisedByTheLastRun } from "./findings.ts";
import type { SourceRefusal } from "./vocabulary.ts";

const originalKeyOf = (documentId: string): string =>
  `documents/${documentId.toLowerCase()}/original`;

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

const countFieldOf = (category: string): string =>
  `findings${category
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("")}`;

// SAFETY: `Object.fromEntries` loses what the mapping guarantees — one entry per category,
// each value the one kind.
const FINDING_COUNT_SHAPE = Object.fromEntries(
  REDACTION_CATEGORIES.map(({ category }) => [countFieldOf(category), "count"]),
) as FindingCountShape;

// SAFETY: as above — one entry per category, and the value of each is a whole number.
const countsOf = (found: ReadonlyMap<string, number>): FindingCounts =>
  Object.fromEntries(
    REDACTION_CATEGORIES.map(({ category }) => [countFieldOf(category), found.get(category) ?? 0]),
  ) as FindingCounts;

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
  }),
});

export type BindUploadInput = {
  readonly name: string;

  readonly fileName: string;

  readonly mediaType: string;

  readonly byteSize: number;
  readonly body: ReadableStream<Uint8Array>;

  readonly sensitivity?: string;
  readonly audience?: string;
  readonly audienceGroups?: readonly string[] | null | undefined;
};

export type BindUploadRefusal =
  | PrincipalRefusal
  | SourceRefusal<
      "role-forbids" | "malformed" | "no-such-group" | "media-type-refused" | "too-large"
    >
  | Error;

export type UploadBound = {
  readonly bindingId: string;
  readonly documentId: string;

  readonly jobId: string;
  readonly auditEventId: string;

  readonly originalKey: string;
};

const INSERT_BINDING = `INSERT INTO source_binding
    (workspace_id, id, name, connector, sensitivity, audience, audience_groups)
  VALUES ($1, $2, $3, $4, $5, $6, $7)`;

const INSERT_DOCUMENT = `INSERT INTO source_document
    (workspace_id, id, binding_id, source_system_id, title, media_type, byte_size, original_key)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`;

const inTransaction = async <T>(
  principal: UserPrincipal,
  door: PostgresDoor,
  work: (principal: UserPrincipal, tx: Tx) => Promise<T>,
): Promise<Result<T, PrincipalRefusal | Error>> => {
  const opened = await attempt(() => withMembership(principal, door, work));
  if (!opened.ok) return err(opened.error);
  if (!opened.value.ok) return err(opened.value.error);
  return ok(opened.value.value);
};

export const bindUpload = async (
  principal: UserPrincipal,
  doors: { readonly postgres: PostgresDoor; readonly objects: ObjectDoor },
  input: BindUploadInput,
): Promise<Result<UploadBound, BindUploadRefusal>> => {
  const admin = requireAdmin(principal);
  if (!admin.ok) return err(admin.error);
  const { workspaceId } = admin.value;

  const bindingId = ulid();
  const documentId = ulid();
  const originalKey = originalKeyOf(documentId);
  const auditEventId = ulid();

  const visibility = visibilityFrom({
    sensitivity: input.sensitivity ?? SENSITIVITY_DEFAULT,
    audience: input.audience ?? AUDIENCE_EVERYONE,
    audienceGroups: input.audienceGroups ?? null,
  });
  if (visibility === undefined) return err("malformed");

  const binding = boundarySchemas.sourceBinding.insert.safeParse({
    workspaceId,
    id: bindingId,
    name: input.name,
    connector: CONNECTOR_UPLOAD,
    sensitivity: visibility.sensitivity,
    audience: visibility.audience,
    audienceGroups: visibility.audienceGroups,
  });
  const document = boundarySchemas.sourceDocument.insert.safeParse({
    workspaceId,
    id: documentId,
    bindingId,
    sourceSystemId: input.fileName,
    title: input.fileName,
    mediaType: input.mediaType,
    byteSize: input.byteSize,
    originalKey,
  });
  if (!binding.success || !document.success) return err("malformed");

  if (!UPLOAD_MEDIA_TYPES.some((allowed) => allowed === document.data.mediaType)) {
    return err("media-type-refused");
  }
  if (document.data.byteSize > UPLOAD_BYTE_CAP) return err("too-large");

  const named = visibility.audienceGroups ?? [];
  if (named.length > 0) {
    const held = await inTransaction(principal, doors.postgres, (fresh, tx) =>
      holdsEveryGroup(fresh, tx, named),
    );
    if (!held.ok) return err(held.error);
    if (!held.value.ok) return err(held.value.error);
    if (!held.value.value) return err("no-such-group");
  }

  const put = await putObject(admin.value, doors.objects, originalKey, input.body);
  if (!put.ok) {
    throw new Error(`sources: the original's key was refused (${put.error})`);
  }

  return inTransaction(principal, doors.postgres, async (fresh, tx) => {
    await tx.query(INSERT_BINDING, [
      binding.data.workspaceId,
      binding.data.id,
      binding.data.name,
      binding.data.connector,
      binding.data.sensitivity,
      binding.data.audience,
      binding.data.audienceGroups,
    ]);
    await tx.query(INSERT_DOCUMENT, [
      document.data.workspaceId,
      document.data.id,
      document.data.bindingId,
      document.data.sourceSystemId,
      document.data.title,
      document.data.mediaType,
      document.data.byteSize,
      document.data.originalKey,
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
      throw new Error(`sources: the index run was refused (${String(queued.error)})`);
    }
    return { bindingId, documentId, jobId: queued.value.jobId, auditEventId, originalKey };
  });
};

export type PublishBindingInput = {
  readonly bindingId: string;

  readonly publishedAt: Date;
  readonly confirmations: {
    readonly lawfulBasisRecorded: boolean;
    readonly privacyInformationUpdated: boolean;
    readonly dpiaReferenced: boolean;
  };
};

export type PublishBindingRefusal =
  | SourceRefusal<
      | "role-forbids"
      | "malformed"
      | "no-such-binding"
      | "not-indexed"
      | "already-published"
      | "confirmation-missing"
    >
  | Error;

export type BindingPublished = {
  readonly bindingId: string;
  readonly auditEventId: string;

  readonly chunks: number;

  readonly dpiaHash: string;
};

// The job row, not source_binding.state: the worker holds only SELECT on that table and cannot
// write its progress there.
const LATEST_INDEX_RUN = `SELECT status FROM job
    WHERE workspace_id = $1 AND kind = $2 AND subject_id = $3
    ORDER BY enqueued_at DESC, id DESC
    LIMIT 1`;

const FINDINGS_BY_CATEGORY = `SELECT f.category, count(*)::int AS found
    FROM finding f
    JOIN source_document d ON d.workspace_id = f.workspace_id AND d.id = f.document_id
   WHERE f.workspace_id = $1 AND d.binding_id = $2 AND ${raisedByTheLastRun("f", "d")}
   GROUP BY f.category`;

export const publishBinding = async (
  principal: UserPrincipal,
  tx: Tx,
  input: PublishBindingInput,
): Promise<Result<BindingPublished, PublishBindingRefusal>> => {
  const acting = adminOnBinding(principal, input.bindingId);
  if (!acting.ok) return err(acting.error);
  const { admin, bindingId, workspaceId } = acting.value;

  if (!CONFIRMATIONS.every((named) => input.confirmations[named] === true)) {
    return err("confirmation-missing");
  }

  const binding = await bindingNamed<{ published_at: Date | null }>(acting.value, tx, {
    columns: "published_at",
    lock: "for-update",
  });
  if (!binding.ok) return err(binding.error);
  if (binding.value.published_at !== null) return err("already-published");

  const run = await attempt(() =>
    tx.query<{ status: string }>(LATEST_INDEX_RUN, [workspaceId, INDEX_KIND, bindingId]),
  );
  if (!run.ok) return err(run.error);

  if (run.value.rows[0]?.status !== JOB_DONE_STATUS) return err("not-indexed");

  const dpia = await dpiaInputFor(admin, tx, { bindingId: bindingId });
  if (!dpia.ok) return err(dpia.error);
  const counted = await attempt(() =>
    tx.query<{ category: string; found: number }>(FINDINGS_BY_CATEGORY, [workspaceId, bindingId]),
  );
  if (!counted.ok) return err(counted.error);
  const found = new Map(counted.value.rows.map((row) => [row.category, row.found]));

  const auditEventId = ulid();
  const published = await attempt(() =>
    tx.query(
      "UPDATE source_binding SET published_at = $3, state = $4 WHERE workspace_id = $1 AND id = $2",
      [workspaceId, bindingId, input.publishedAt, BINDING_PUBLISHED_STATE],
    ),
  );
  if (!published.ok) return err(published.error);
  const stamped = await attempt(() =>
    tx.query(
      `UPDATE "index".chunk SET published_at = $3 WHERE workspace_id = $1 AND binding_id = $2`,
      [workspaceId, bindingId, input.publishedAt],
    ),
  );
  if (!stamped.ok) return err(stamped.error);

  await record(admin, tx, {
    id: auditEventId,
    act: BINDING_ACTS.published,
    subjectId: bindingId,
    detail: {
      bindingId: bindingId,
      lawfulBasisRecorded: input.confirmations.lawfulBasisRecorded,
      privacyInformationUpdated: input.confirmations.privacyInformationUpdated,
      dpiaReferenced: input.confirmations.dpiaReferenced,
      ...countsOf(found),
      dpiaHash: dpia.value.hash,
    },
  });
  return ok({
    bindingId: bindingId,
    auditEventId,
    chunks: stamped.value.rowCount ?? 0,
    dpiaHash: dpia.value.hash,
  });
};

export type ReprocessBindingInput = {
  readonly bindingId: string;

  readonly reason: IndexReason;
};

export type ReprocessBindingRefusal =
  | SourceRefusal<"role-forbids" | "malformed" | "no-such-binding">
  | Error;

export type BindingReprocessed = {
  readonly bindingId: string;

  readonly jobId: string;

  readonly chunks: number;

  readonly findings: number;
};

export const reprocessBinding = async (
  principal: UserPrincipal,
  tx: Tx,
  input: ReprocessBindingInput,
): Promise<Result<BindingReprocessed, ReprocessBindingRefusal>> => {
  const acting = adminOnBinding(principal, input.bindingId);
  if (!acting.ok) return err(acting.error);
  const { admin, bindingId, workspaceId } = acting.value;

  const standing = await bindingNamed(acting.value, tx, { columns: "1", lock: "for-update" });
  if (!standing.ok) return err(standing.error);

  const queued = await enqueueJobIn(admin, tx, {
    workspaceId,
    kind: INDEX_KIND,
    subjectId: bindingId,
    reason: input.reason,
  });
  if (!queued.ok) return err(queued.error);
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
  return ok({
    bindingId: bindingId,
    jobId: queued.value.jobId,
    chunks: wiped.value.rowCount ?? 0,
    findings: raised.value.rowCount ?? 0,
  });
};
