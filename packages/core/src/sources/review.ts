import { z } from "zod";

import {
  boundarySchemas,
  FINDING_DISMISSED_STATE,
  FINDING_UNREVIEWED_STATE,
  INDEX_KIND,
  REDACTION_ALWAYS_TIER,
  SENSITIVITIES,
  SENSITIVITY_DEFAULT,
  type FINDING_REVIEW_STATES,
  type INDEX_REASONS,
} from "@better-answers/schema";
import { byCodeUnit } from "@better-answers/schema/code-unit";

import { narrower, type Sensitivity } from "../access/index.ts";
import {
  action,
  batchIdFor,
  declareActions,
  recordEach,
  STORED_DETAIL_KEYS,
} from "../audit/index.ts";
import { cascadingVisibility } from "../concepts/index.ts";
import { actorIdOf, attempt, err, ok, type Result, type UserPrincipal } from "../kernel/index.ts";
import { enqueueJobIn, syncRefused, latestIndexOutcomeIn, type JobOutcome } from "../runs/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import {
  adminOnConnectedSource,
  connectedSourceNamed,
  CONNECTED_SOURCE_ID,
  type ActingOnConnectedSource,
  type ConnectedSourceId,
} from "./admin-connected-source.ts";
import { REDACTION_CATEGORIES } from "./dpia.ts";
import { raisedByTheLastSync, RESTORE_REASON, restoreFinding } from "./findings.ts";
import type { SourceRefusal } from "./vocabulary.ts";

export const findingsOfInput = z.object({ connectedSourceId: CONNECTED_SOURCE_ID });

export type FindingsOfInput = z.output<typeof findingsOfInput>;

export type GroupOfFindings = {
  readonly documentId: string;
  readonly title: string;
  readonly sensitivity: string;
  readonly category: string;
  readonly ruleId: string;
  readonly tier: string;

  readonly specialCategory: boolean;

  readonly found: number;

  readonly overriddenByErasure: number;

  readonly dismissed: number;
};

export type FindingsOfRefusal = SourceRefusal<"role-forbids" | "no-such-binding"> | Error;

const SPECIAL_CATEGORIES = new Set<string>(
  REDACTION_CATEGORIES.filter((entry) => entry.specialCategory).map((entry) => entry.category),
);

const HOLDS_AN_UNREVIEWED_SPECIAL_CATEGORY = `SELECT EXISTS (
    SELECT 1 FROM finding f
      JOIN source_document d ON d.workspace_id = f.workspace_id AND d.id = f.document_id
     WHERE f.workspace_id = $1 AND d.connected_source_id = $2 AND f.category = ANY($3::text[])
       AND f.review_state = $4 AND ${raisedByTheLastSync("f", "d")}
  ) AS held`;

export const holdsAnUnreviewedSpecialCategory = async (
  acting: ActingOnConnectedSource,
  tx: Tx,
): Promise<Result<boolean, Error>> => {
  const found = await attempt(() =>
    tx.query<{ held: boolean }>(HOLDS_AN_UNREVIEWED_SPECIAL_CATEGORY, [
      acting.workspaceId,
      acting.connectedSourceId,
      [...SPECIAL_CATEGORIES],
      FINDING_UNREVIEWED_STATE,
    ]),
  );
  if (!found.ok) return err(found.error);
  return ok(found.value.rows[0]?.held === true);
};

const sensitivityOf = (word: string): Sensitivity | undefined =>
  SENSITIVITIES.find((known) => known === word);

const effectiveClass = (own: string | null, connectedSource: string): Sensitivity | undefined => {
  const inherited = sensitivityOf(connectedSource);
  if (inherited === undefined || own === null) return inherited;
  const held = sensitivityOf(own);
  return held === undefined ? undefined : narrower(held, inherited);
};

const BROKEN_SENSITIVITY = new Error(
  "a source document's sensitivity is not one the visibility words hold",
);

const GROUPS_OF_FINDINGS = `SELECT d.id AS "documentId", d.title,
            d.sensitivity AS "documentSensitivity", b.sensitivity AS "connectedSourceSensitivity",
            f.category, f.rule_id AS "ruleId", f.tier, count(*)::int AS found,
            count(*) FILTER (
              WHERE f.restored_at IS NOT NULL
                AND (f.document_id, f.rule_id, f.char_start, f.char_end) IN
                    (SELECT * FROM unnest($3::text[], $4::text[], $5::int[], $6::int[]))
            )::int AS "overriddenByErasure",
            count(*) FILTER (WHERE f.review_state = '${FINDING_DISMISSED_STATE}')::int AS dismissed
       FROM finding f
       JOIN source_document d ON d.workspace_id = f.workspace_id AND d.id = f.document_id
       JOIN connected_source b ON b.workspace_id = d.workspace_id AND b.id = d.connected_source_id
      WHERE f.workspace_id = $1 AND d.connected_source_id = $2 AND ${raisedByTheLastSync("f", "d")}
      GROUP BY d.id, d.title, d.sensitivity, b.sensitivity, f.category, f.rule_id, f.tier
      ORDER BY f.category, f.rule_id, d.title, d.id`;

const OVERRIDDEN_KEY = "restores_overridden_by_erasure";

const FINDING_COLUMNS = boundarySchemas.finding.select.shape;
const OVERRIDDEN_SPAN = z.object({
  document_id: FINDING_COLUMNS.documentId,
  rule_id: FINDING_COLUMNS.ruleId,
  char_start: FINDING_COLUMNS.charStart,
  char_end: FINDING_COLUMNS.charEnd,
});

const UNREADABLE_RUN = new Error(
  "the connected source's last sync names the kept spans an erasure overrode in a shape the review cannot read",
);

const overriddenSpansOf = (
  outcome: JobOutcome | null,
): Result<ReadonlyArray<z.infer<typeof OVERRIDDEN_SPAN>>, Error> => {
  const listed = outcome?.[OVERRIDDEN_KEY];
  if (listed === undefined) return ok([]);
  const spans = z.array(OVERRIDDEN_SPAN).safeParse(listed);
  return spans.success ? ok(spans.data) : err(UNREADABLE_RUN);
};

type GroupRow = Omit<GroupOfFindings, "specialCategory" | "sensitivity"> & {
  readonly documentSensitivity: string | null;
  readonly connectedSourceSensitivity: string;
};

export const findingsOf = async (
  principal: UserPrincipal,
  tx: Tx,
  input: FindingsOfInput,
): Promise<Result<readonly GroupOfFindings[], FindingsOfRefusal>> => {
  const acting = adminOnConnectedSource(principal, input.connectedSourceId);
  if (!acting.ok) return err(acting.error);
  const { workspaceId, connectedSourceId } = acting.value;

  const standing = await connectedSourceNamed(acting.value, tx, { columns: "1", lock: "none" });
  if (!standing.ok) return err(standing.error);

  const lastSync = await latestIndexOutcomeIn(acting.value.admin, tx, { connectedSourceId });
  if (!lastSync.ok) return err(lastSync.error);
  const named = overriddenSpansOf(lastSync.value);
  if (!named.ok) return err(named.error);
  const overridden = named.value;

  const grouped = await attempt(() =>
    tx.query<GroupRow>(GROUPS_OF_FINDINGS, [
      workspaceId,
      connectedSourceId,
      overridden.map((span) => span.document_id),
      overridden.map((span) => span.rule_id),
      overridden.map((span) => span.char_start),
      overridden.map((span) => span.char_end),
    ]),
  );
  if (!grouped.ok) return err(grouped.error);

  const groups: GroupOfFindings[] = [];
  for (const { documentSensitivity, connectedSourceSensitivity, ...row } of grouped.value.rows) {
    const sensitivity = effectiveClass(documentSensitivity, connectedSourceSensitivity);
    if (sensitivity === undefined) return err(BROKEN_SENSITIVITY);
    groups.push({ ...row, sensitivity, specialCategory: SPECIAL_CATEGORIES.has(row.category) });
  }
  return ok(groups);
};

export const groupOfFindingsKey = boundarySchemas.finding.select.pick({
  documentId: true,
  category: true,
  ruleId: true,
  tier: true,
});

type GroupOfFindingsKey = z.output<typeof groupOfFindingsKey>;

const commandedGroups = z.array(groupOfFindingsKey).min(1);

const sameGroupOfFindings = (left: GroupOfFindingsKey, right: GroupOfFindingsKey): boolean =>
  left.documentId === right.documentId &&
  left.category === right.category &&
  left.ruleId === right.ruleId &&
  left.tier === right.tier;

const distinctGroupsOfFindings = (
  groupsOfFindings: readonly GroupOfFindingsKey[],
): readonly GroupOfFindingsKey[] =>
  groupsOfFindings.filter(
    (groupOfFindings, index) =>
      groupsOfFindings.findIndex((other) => sameGroupOfFindings(other, groupOfFindings)) === index,
  );

const groupOfFindingsParameters = (groupsOfFindings: readonly GroupOfFindingsKey[]) =>
  [
    groupsOfFindings.map((groupOfFindings) => groupOfFindings.documentId),
    groupsOfFindings.map((groupOfFindings) => groupOfFindings.category),
    groupsOfFindings.map((groupOfFindings) => groupOfFindings.ruleId),
    groupsOfFindings.map((groupOfFindings) => groupOfFindings.tier),
  ] as const;

const groupOfFindingsClause = (alias: string, first: number): string =>
  `(${alias}.document_id, ${alias}.category, ${alias}.rule_id, ${alias}.tier) IN
        (SELECT * FROM unnest($${first}::text[], $${first + 1}::text[],
                              $${first + 2}::text[], $${first + 3}::text[]))`;

export const keepInTextInput = z.object({
  connectedSourceId: CONNECTED_SOURCE_ID,

  groupsOfFindings: commandedGroups,

  reason: RESTORE_REASON,
});

export type KeepInTextInput = z.output<typeof keepInTextInput>;

export type KeepInTextRefusal =
  | SourceRefusal<"role-forbids" | "no-such-binding" | "no-such-finding" | "not-the-always-set">
  | Error;

export type KeptInText = {
  readonly connectedSourceId: string;

  readonly documentIds: readonly string[];

  readonly batchId: string | undefined;

  readonly jobId: string;
};

const FINDINGS_OF_GROUPS = `SELECT f.id, f.document_id AS "documentId", f.category,
            f.rule_id AS "ruleId", f.tier
       FROM finding f
       JOIN source_document d ON d.workspace_id = f.workspace_id AND d.id = f.document_id
      WHERE f.workspace_id = $1 AND d.connected_source_id = $2 AND ${raisedByTheLastSync("f", "d")}
        AND ${groupOfFindingsClause("f", 3)}
      ORDER BY f.id
        FOR UPDATE OF f`;

type HeldSpan = GroupOfFindingsKey & { readonly id: string };

const spansOfGroups = async (
  tx: Tx,
  workspaceId: string,
  connectedSourceId: string,
  groupsOfFindings: readonly GroupOfFindingsKey[],
): Promise<Result<readonly HeldSpan[], "no-such-finding" | Error>> => {
  const held = await attempt(() =>
    tx.query<HeldSpan>(FINDINGS_OF_GROUPS, [
      workspaceId,
      connectedSourceId,
      ...groupOfFindingsParameters(groupsOfFindings),
    ]),
  );
  if (!held.ok) return err(held.error);
  const spans = held.value.rows;
  const everyGroupHeld = groupsOfFindings.every((groupOfFindings) =>
    spans.some((span) => sameGroupOfFindings(span, groupOfFindings)),
  );
  return everyGroupHeld ? ok(spans) : err("no-such-finding");
};

const documentsHolding = (spans: readonly HeldSpan[]): readonly string[] =>
  [...new Set(spans.map((span) => span.documentId))].toSorted(byCodeUnit);

type CommandedSpans = {
  readonly acting: ActingOnConnectedSource;
  readonly spans: readonly HeldSpan[];
};

type SpansRefusal<GroupRefusal> =
  | GroupRefusal
  | SourceRefusal<"role-forbids" | "no-such-binding" | "no-such-finding">
  | Error;

/** Every group is judged before the first read, so a refused one lands nothing beside it. */
const spansCommanded = async <GroupRefusal extends string>(
  principal: UserPrincipal,
  tx: Tx,
  input: {
    readonly connectedSourceId: ConnectedSourceId;
    readonly groupsOfFindings: readonly GroupOfFindingsKey[];
  },
  refusalOf: (groupOfFindings: GroupOfFindingsKey) => GroupRefusal | undefined,
): Promise<Result<CommandedSpans, SpansRefusal<GroupRefusal>>> => {
  const acting = adminOnConnectedSource(principal, input.connectedSourceId);
  if (!acting.ok) return err(acting.error);

  const groupsOfFindings = distinctGroupsOfFindings(input.groupsOfFindings);
  for (const groupOfFindings of groupsOfFindings) {
    const refused = refusalOf(groupOfFindings);
    if (refused !== undefined) return err(refused);
  }

  const standing = await connectedSourceNamed(acting.value, tx, {
    columns: "1",
    lock: "for-update",
  });
  if (!standing.ok) return err(standing.error);

  const held = await spansOfGroups(
    tx,
    acting.value.workspaceId,
    acting.value.connectedSourceId,
    groupsOfFindings,
  );
  if (!held.ok) return err(held.error);
  return ok({ acting: acting.value, spans: held.value });
};

const syncQueued = async (
  { admin, workspaceId, connectedSourceId }: ActingOnConnectedSource,
  tx: Tx,
  reason: Extract<(typeof INDEX_REASONS)[number], "restored" | "dismissed">,
): Promise<string> => {
  const queued = await enqueueJobIn(admin, tx, {
    workspaceId,
    kind: INDEX_KIND,
    subjectId: connectedSourceId,
    reason,
  });
  if (!queued.ok) {
    throw syncRefused(queued.error);
  }
  return queued.value.jobId;
};

const KEPT_IN_TEXT = "kept-in-text" satisfies (typeof FINDING_REVIEW_STATES)[number];

/**
 * A later keep does not revise what a dismissal said the span is; the keep has the restore
 * columns.
 */
const KEPT_IN_TEXT_REVIEW = `UPDATE finding
        SET review_state = $3, reviewed_by = restored_by,
            reviewed_at = restored_at, review_reason = restore_reason
      WHERE workspace_id = $1 AND id = ANY($2::text[]) AND review_state <> $4`;

/**
 * Restores each span the document's last redaction raised in the groups, marks those not
 * dismissed as kept in text, and queues a sync. A group outside the always tier refuses the
 * whole command.
 */
export const keepInText = async (
  principal: UserPrincipal,
  tx: Tx,
  input: KeepInTextInput,
): Promise<Result<KeptInText, KeepInTextRefusal>> => {
  const commanded = await spansCommanded(principal, tx, input, (groupOfFindings) =>
    groupOfFindings.tier === REDACTION_ALWAYS_TIER ? undefined : "not-the-always-set",
  );
  if (!commanded.ok) return err(commanded.error);
  const { acting, spans } = commanded.value;
  const { admin, workspaceId, connectedSourceId } = acting;

  const named = spans.map((span) => span.id);
  /** One audit event per span, so the batch counts spans, not the documents the answer names. */
  const batchId = batchIdFor(named.length);
  for (const findingId of named) {
    const restored = await restoreFinding(admin, tx, {
      findingId,
      reason: input.reason,
      batchId,
    });
    if (!restored.ok) return err(restored.error);
  }
  const reviewed = await attempt(() =>
    tx.query(KEPT_IN_TEXT_REVIEW, [workspaceId, named, KEPT_IN_TEXT, FINDING_DISMISSED_STATE]),
  );
  if (!reviewed.ok) return err(reviewed.error);

  const jobId = await syncQueued(acting, tx, "restored");
  return ok({ connectedSourceId, documentIds: documentsHolding(spans), batchId, jobId });
};

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

export type NarrowDocumentsRefusal =
  | SourceRefusal<"role-forbids" | "no-such-binding" | "no-such-document" | "widening-refused">
  | Error;

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

/**
 * Sets each named document's sensitivity, marks the groups' unreviewed findings narrowed, and
 * recomputes the visibility of what those documents source. A sensitivity wider than any
 * document's effective class, the narrower of its own and its source's, refuses the whole command.
 */
export const narrowDocuments = async (
  principal: UserPrincipal,
  tx: Tx,
  input: NarrowDocumentsInput,
): Promise<Result<DocumentsNarrowed, NarrowDocumentsRefusal>> => {
  const acting = adminOnConnectedSource(principal, input.connectedSourceId);
  if (!acting.ok) return err(acting.error);
  const { admin, connectedSourceId } = acting.value;

  const next = input.sensitivity;
  const groupsOfFindings = distinctGroupsOfFindings(input.groupsOfFindings);
  const named = [...new Set(groupsOfFindings.map((groupOfFindings) => groupOfFindings.documentId))];

  const cascaded = await cascadingVisibility(
    admin,
    tx,
    { connectedSourceId, documentIds: named },
    (tx) => documentsNarrowedBy(acting.value, tx, groupsOfFindings, named, next),
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

export type DismissAsNotSpecialCategoryRefusal =
  | SourceRefusal<"role-forbids" | "no-such-binding" | "no-such-finding" | "not-special-category">
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

/**
 * Dismisses each finding the document's last redaction raised in the groups, with an audit event per
 * document, and queues a sync. A group outside the special category refuses the whole
 * command.
 */
export const dismissAsNotSpecialCategory = async (
  principal: UserPrincipal,
  tx: Tx,
  input: DismissAsNotSpecialCategoryInput,
): Promise<Result<DismissedAsNotSpecialCategory, DismissAsNotSpecialCategoryRefusal>> => {
  const commanded = await spansCommanded(principal, tx, input, (groupOfFindings) =>
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
