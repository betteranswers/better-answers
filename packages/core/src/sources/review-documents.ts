import { z } from "zod";

import {
  boundarySchemas,
  FINDING_DISMISSED_STATE,
  FINDING_UNREVIEWED_STATE,
  SENSITIVITY_DEFAULT,
  type FINDING_REVIEW_STATES,
} from "@better-answers/schema";

import { narrower, type Sensitivity } from "../access/index.ts";
import { action, declareActions, recordEach, STORED_DETAIL_KEYS } from "../audit/index.ts";
import { cascadingVisibility } from "../concepts/index.ts";
import {
  actorIdOf,
  admit,
  ADMIN_ALONE,
  attempt,
  declareAction,
  err,
  ok,
  type RefusalOf,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import {
  adminOnConnectedSource,
  connectedSourceNamed,
  CONNECTED_SOURCE_ID,
  type ActingOnConnectedSource,
} from "./admin-connected-source.ts";
import { raisedByTheLastSync } from "./findings.ts";
import {
  commandedGroups,
  groupOfFindingsClause,
  effectiveClass,
  BROKEN_SENSITIVITY,
  groupOfFindingsParameters,
  distinctGroupsOfFindings,
  spansCommanded,
  SPECIAL_CATEGORIES,
  documentsHolding,
  syncQueued,
  type GroupOfFindingsKey,
} from "./review.ts";
import type { SourceRefusal } from "./vocabulary.ts";

const REVIEW_ACTIONS = declareActions("sources", {
  narrowed: action("sources.document.narrowed", {
    documentId: "id",
    [STORED_DETAIL_KEYS.connectedSourceId]: "id",
    sensitivity: "sensitivity",
  }),
  dismissed: action("sources.document.special_category_dismissed", {
    documentId: "id",
    [STORED_DETAIL_KEYS.connectedSourceId]: "id",
    findingCount: "count",
  }),
});

export const narrowDocumentsInput = z.object({
  connectedSourceId: CONNECTED_SOURCE_ID,

  groupsOfFindings: commandedGroups,

  sensitivity: boundarySchemas.sourceDocument.select.shape.sensitivity
    .unwrap()
    .default(SENSITIVITY_DEFAULT),
});

export type NarrowDocumentsInput = z.output<typeof narrowDocumentsInput>;

const narrowDocumentsAction = declareAction({
  admits: ADMIN_ALONE,
  input: narrowDocumentsInput,
  refuses: ["role-forbids", "no-such-binding", "no-such-document", "widening-refused"],
});

export type NarrowDocumentsRefusal = SourceRefusal<RefusalOf<typeof narrowDocumentsAction>> | Error;

export type DocumentsNarrowed = {
  readonly connectedSourceId: string;

  readonly documentIds: readonly string[];
  readonly sensitivity: Sensitivity;

  readonly batchId: string | undefined;

  readonly concepts: readonly string[];

  readonly writeUps: readonly string[];
};

const DOCUMENTS_UNDER = `SELECT id, sensitivity FROM source_document
      WHERE workspace_id = $1 AND connected_source_id = $2 AND id = ANY($3::text[])
      ORDER BY id
        FOR UPDATE`;

type DocumentRow = { readonly id: string; readonly sensitivity: string | null };

const NARROWED = "narrowed" satisfies (typeof FINDING_REVIEW_STATES)[number];

const NARROWED_REVIEW = `UPDATE finding f
        SET review_state = $2, reviewed_by = $3, reviewed_at = now()
       FROM source_document d
      WHERE f.workspace_id = $1 AND f.review_state = $4 AND ${groupOfFindingsClause("f", 5)}
        AND d.workspace_id = f.workspace_id AND d.id = f.document_id
        AND ${raisedByTheLastSync("f", "d")}`;

const documentsToNarrow = async (
  acting: ActingOnConnectedSource,
  tx: Tx,
  named: readonly string[],
  next: Sensitivity,
): Promise<Result<readonly DocumentRow[], NarrowDocumentsRefusal>> => {
  const connectedSource = await connectedSourceNamed<{ readonly sensitivity: string }>(acting, tx, {
    columns: "sensitivity",
    lock: "for-update",
  });
  if (!connectedSource.ok) return err(connectedSource.error);

  const documents = await attempt(() =>
    tx.query<DocumentRow>(DOCUMENTS_UNDER, [acting.workspaceId, acting.connectedSourceId, named]),
  );
  if (!documents.ok) return err(documents.error);
  const rows = documents.value.rows;
  if (rows.length !== named.length) return err("no-such-document");

  for (const row of rows) {
    const effective = effectiveClass(row.sensitivity, connectedSource.value.sensitivity);
    if (effective === undefined) return err(BROKEN_SENSITIVITY);
    if (narrower(next, effective) !== next) return err("widening-refused");
  }
  return ok(rows);
};

type DocumentsNarrowedBy = Pick<DocumentsNarrowed, "documentIds" | "batchId">;

const documentsNarrowedBy = async (
  acting: ActingOnConnectedSource,
  tx: Tx,
  groupsOfFindings: readonly GroupOfFindingsKey[],
  named: readonly string[],
  next: Sensitivity,
): Promise<Result<DocumentsNarrowedBy, NarrowDocumentsRefusal>> => {
  const { admin, workspaceId, connectedSourceId } = acting;
  const documents = await documentsToNarrow(acting, tx, named, next);
  if (!documents.ok) return err(documents.error);

  const narrowed = await attempt(() =>
    tx.query(
      `UPDATE source_document SET sensitivity = $4, narrowed_to = $4
        WHERE workspace_id = $1 AND connected_source_id = $2 AND id = ANY($3::text[])`,
      [workspaceId, connectedSourceId, named, next],
    ),
  );
  if (!narrowed.ok) return err(narrowed.error);

  const reviewed = await attempt(() =>
    tx.query(NARROWED_REVIEW, [
      workspaceId,
      NARROWED,
      actorIdOf(admin),
      FINDING_UNREVIEWED_STATE,
      ...groupOfFindingsParameters(groupsOfFindings),
    ]),
  );
  if (!reviewed.ok) return err(reviewed.error);

  const documentIds = documents.value.map((row) => row.id);
  const batchId = await recordEach(
    admin,
    tx,
    REVIEW_ACTIONS.narrowed,
    documentIds.map((documentId) => ({
      subjectId: documentId,
      detail: {
        documentId,
        [STORED_DETAIL_KEYS.connectedSourceId]: connectedSourceId,
        sensitivity: next,
      },
    })),
  );
  return ok({ documentIds, batchId });
};

export const narrowDocuments = async (
  principal: UserPrincipal,
  tx: Tx,
  input: NarrowDocumentsInput,
): Promise<Result<DocumentsNarrowed, NarrowDocumentsRefusal>> => {
  const admitted = admit(narrowDocumentsAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const acting = adminOnConnectedSource(admitted.value, input.connectedSourceId);
  const { admin, connectedSourceId } = acting;

  const next = input.sensitivity;
  const groupsOfFindings = distinctGroupsOfFindings(input.groupsOfFindings);
  const named = [...new Set(groupsOfFindings.map((groupOfFindings) => groupOfFindings.documentId))];

  const cascaded = await cascadingVisibility(
    admin,
    tx,
    { connectedSourceId, documentIds: named },
    () => documentsNarrowedBy(acting, tx, groupsOfFindings, named, next),
  );
  if (!cascaded.ok) return err(cascaded.error);
  const { written, concepts, writeUps } = cascaded.value;
  return ok({ connectedSourceId, ...written, sensitivity: next, concepts, writeUps });
};

export const dismissAsNotSpecialCategoryInput = z.object({
  connectedSourceId: CONNECTED_SOURCE_ID,

  groupsOfFindings: commandedGroups,

  reason: boundarySchemas.finding.select.shape.reviewReason.unwrap(),
});

export type DismissAsNotSpecialCategoryInput = z.output<typeof dismissAsNotSpecialCategoryInput>;

const dismissAsNotSpecialCategoryAction = declareAction({
  admits: ADMIN_ALONE,
  input: dismissAsNotSpecialCategoryInput,
  refuses: ["role-forbids", "no-such-binding", "no-such-finding", "not-special-category"],
});

export type DismissAsNotSpecialCategoryRefusal =
  | SourceRefusal<RefusalOf<typeof dismissAsNotSpecialCategoryAction>>
  | Error;

export type DismissedAsNotSpecialCategory = {
  readonly connectedSourceId: string;

  readonly documentIds: readonly string[];

  readonly batchId: string | undefined;

  readonly jobId: string;
};

const DISMISSED_REVIEW = `UPDATE finding
        SET review_state = $3, reviewed_by = $4, reviewed_at = now(), review_reason = $5
      WHERE workspace_id = $1 AND id = ANY($2::text[])`;

export const dismissAsNotSpecialCategory = async (
  principal: UserPrincipal,
  tx: Tx,
  input: DismissAsNotSpecialCategoryInput,
): Promise<Result<DismissedAsNotSpecialCategory, DismissAsNotSpecialCategoryRefusal>> => {
  const admitted = admit(dismissAsNotSpecialCategoryAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const commanded = await spansCommanded(admitted.value, tx, input, (groupOfFindings) =>
    SPECIAL_CATEGORIES.has(groupOfFindings.category) ? undefined : "not-special-category",
  );
  if (!commanded.ok) return err(commanded.error);
  const { acting, spans } = commanded.value;
  const { admin, workspaceId, connectedSourceId } = acting;

  const reviewed = await attempt(() =>
    tx.query(DISMISSED_REVIEW, [
      workspaceId,
      spans.map((span) => span.id),
      FINDING_DISMISSED_STATE,
      actorIdOf(admin),
      input.reason,
    ]),
  );
  if (!reviewed.ok) return err(reviewed.error);

  const documentIds = documentsHolding(spans);
  const batchId = await recordEach(
    admin,
    tx,
    REVIEW_ACTIONS.dismissed,
    documentIds.map((documentId) => ({
      subjectId: documentId,
      detail: {
        documentId,
        [STORED_DETAIL_KEYS.connectedSourceId]: connectedSourceId,
        findingCount: spans.filter((span) => span.documentId === documentId).length,
      },
    })),
  );

  const jobId = await syncQueued(acting, tx, "dismissed");
  return ok({ connectedSourceId, documentIds, batchId, jobId });
};
