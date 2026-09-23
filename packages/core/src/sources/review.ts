import {
  boundarySchemas,
  FINDING_UNREVIEWED_STATE,
  INDEX_KIND,
  REDACTION_ALWAYS_TIER,
  SENSITIVITIES,
  SENSITIVITY_DEFAULT,
  type FINDING_REVIEW_STATES,
} from "@better-answers/schema";
import { z } from "zod";

import { narrower, type Sensitivity } from "../access/index.ts";
import { act, declareActs, record } from "../audit/index.ts";
import { openingACascadeOverHeldGroups } from "../concepts/index.ts";
import {
  actorIdOf,
  attempt,
  err,
  ok,
  ulid,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import {
  enqueueJobIn,
  indexRunRefused,
  latestIndexOutcomeIn,
  type JobOutcome,
} from "../runs/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import { adminOnBinding, bindingNamed, BINDING_ID } from "./admin-binding.ts";
import { cascadeOverEvidence } from "./cascade.ts";
import { REDACTION_CATEGORIES } from "./dpia.ts";
import { raisedByTheLastRun, RESTORE_REASON, restoreFinding } from "./findings.ts";
import type { SourceRefusal } from "./vocabulary.ts";

export const findingsOfInput = z.object({ bindingId: BINDING_ID });

export type FindingsOfInput = z.output<typeof findingsOfInput>;

export type FindingGroup = {
  readonly documentId: string;
  readonly title: string;
  readonly sensitivity: string;
  readonly category: string;
  readonly ruleId: string;
  readonly tier: string;

  readonly specialCategory: boolean;

  readonly found: number;

  readonly overriddenByErasure: number;
};

export type FindingsOfRefusal = SourceRefusal<"role-forbids" | "no-such-binding"> | Error;

const SPECIAL_CATEGORIES = new Set<string>(
  REDACTION_CATEGORIES.filter((entry) => entry.specialCategory).map((entry) => entry.category),
);

const classOf = (word: string): Sensitivity | undefined =>
  SENSITIVITIES.find((known) => known === word);

const effectiveClass = (own: string | null, binding: string): Sensitivity | undefined => {
  const inherited = classOf(binding);
  if (inherited === undefined || own === null) return inherited;
  const held = classOf(own);
  return held === undefined ? undefined : narrower(held, inherited);
};

const BROKEN_CLASS = new Error("a source document's class is not one the visibility words hold");

const FINDING_GROUPS = `SELECT d.id AS "documentId", d.title,
            d.sensitivity AS "documentSensitivity", b.sensitivity AS "bindingSensitivity",
            f.category, f.rule_id AS "ruleId", f.tier, count(*)::int AS found,
            count(*) FILTER (
              WHERE f.restored_at IS NOT NULL
                AND (f.document_id, f.rule_id, f.char_start, f.char_end) IN
                    (SELECT * FROM unnest($3::text[], $4::text[], $5::int[], $6::int[]))
            )::int AS "overriddenByErasure"
       FROM finding f
       JOIN source_document d ON d.workspace_id = f.workspace_id AND d.id = f.document_id
       JOIN source_binding b ON b.workspace_id = d.workspace_id AND b.id = d.binding_id
      WHERE f.workspace_id = $1 AND d.binding_id = $2 AND ${raisedByTheLastRun("f", "d")}
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
  "the binding's last index run names the kept spans an erasure overrode in a shape the review cannot read",
);

const overriddenSpansOf = (
  outcome: JobOutcome | null,
): Result<ReadonlyArray<z.infer<typeof OVERRIDDEN_SPAN>>, Error> => {
  const listed = outcome?.[OVERRIDDEN_KEY];
  if (listed === undefined) return ok([]);
  const spans = z.array(OVERRIDDEN_SPAN).safeParse(listed);
  return spans.success ? ok(spans.data) : err(UNREADABLE_RUN);
};

type GroupRow = Omit<FindingGroup, "specialCategory" | "sensitivity"> & {
  readonly documentSensitivity: string | null;
  readonly bindingSensitivity: string;
};

export const findingsOf = async (
  principal: UserPrincipal,
  tx: Tx,
  input: FindingsOfInput,
): Promise<Result<readonly FindingGroup[], FindingsOfRefusal>> => {
  const acting = adminOnBinding(principal, input.bindingId);
  if (!acting.ok) return err(acting.error);
  const { workspaceId, bindingId } = acting.value;

  const standing = await bindingNamed(acting.value, tx, { columns: "1", lock: "none" });
  if (!standing.ok) return err(standing.error);

  const lastRun = await latestIndexOutcomeIn(principal, tx, { bindingId });
  if (!lastRun.ok) return err(lastRun.error);
  const named = overriddenSpansOf(lastRun.value);
  if (!named.ok) return err(named.error);
  const overridden = named.value;

  const grouped = await attempt(() =>
    tx.query<GroupRow>(FINDING_GROUPS, [
      workspaceId,
      bindingId,
      overridden.map((span) => span.document_id),
      overridden.map((span) => span.rule_id),
      overridden.map((span) => span.char_start),
      overridden.map((span) => span.char_end),
    ]),
  );
  if (!grouped.ok) return err(grouped.error);

  const groups: FindingGroup[] = [];
  for (const { documentSensitivity, bindingSensitivity, ...row } of grouped.value.rows) {
    const sensitivity = effectiveClass(documentSensitivity, bindingSensitivity);
    if (sensitivity === undefined) return err(BROKEN_CLASS);
    groups.push({ ...row, sensitivity, specialCategory: SPECIAL_CATEGORIES.has(row.category) });
  }
  return ok(groups);
};

export const findingGroupKey = boundarySchemas.finding.select.pick({
  documentId: true,
  category: true,
  ruleId: true,
  tier: true,
});

export type FindingGroupKey = z.output<typeof findingGroupKey>;

const commandedGroups = z.array(findingGroupKey).min(1);

const sameFindingGroup = (left: FindingGroupKey, right: FindingGroupKey): boolean =>
  left.documentId === right.documentId &&
  left.category === right.category &&
  left.ruleId === right.ruleId &&
  left.tier === right.tier;

const distinctFindingGroups = (
  findingGroups: readonly FindingGroupKey[],
): readonly FindingGroupKey[] =>
  findingGroups.filter(
    (findingGroup, index) =>
      findingGroups.findIndex((other) => sameFindingGroup(other, findingGroup)) === index,
  );

const findingGroupParameters = (findingGroups: readonly FindingGroupKey[]) =>
  [
    findingGroups.map((findingGroup) => findingGroup.documentId),
    findingGroups.map((findingGroup) => findingGroup.category),
    findingGroups.map((findingGroup) => findingGroup.ruleId),
    findingGroups.map((findingGroup) => findingGroup.tier),
  ] as const;

const findingGroupClause = (alias: string, first: number): string =>
  `(${alias}.document_id, ${alias}.category, ${alias}.rule_id, ${alias}.tier) IN
        (SELECT * FROM unnest($${first}::text[], $${first + 1}::text[],
                              $${first + 2}::text[], $${first + 3}::text[]))`;

export const keepInTextInput = z.object({
  bindingId: BINDING_ID,

  findingGroups: commandedGroups,

  reason: RESTORE_REASON,
});

export type KeepInTextInput = z.output<typeof keepInTextInput>;

export type KeepInTextRefusal =
  | SourceRefusal<"role-forbids" | "no-such-binding" | "no-such-finding" | "not-the-always-set">
  | Error;

export type KeptInText = {
  readonly bindingId: string;

  readonly findingIds: readonly string[];

  readonly batchId: string | undefined;

  readonly jobId: string;
};

const FINDINGS_OF_GROUPS = `SELECT f.id, f.document_id AS "documentId", f.category,
            f.rule_id AS "ruleId", f.tier
       FROM finding f
       JOIN source_document d ON d.workspace_id = f.workspace_id AND d.id = f.document_id
      WHERE f.workspace_id = $1 AND d.binding_id = $2 AND ${raisedByTheLastRun("f", "d")}
        AND ${findingGroupClause("f", 3)}
      ORDER BY f.id
        FOR UPDATE OF f`;

const KEPT_IN_TEXT = "kept-in-text" satisfies (typeof FINDING_REVIEW_STATES)[number];

const KEPT_IN_TEXT_REVIEW = `UPDATE finding
        SET review_state = $3, reviewed_by = restored_by,
            reviewed_at = restored_at, review_reason = restore_reason
      WHERE workspace_id = $1 AND id = ANY($2::text[])`;

export const keepInText = async (
  principal: UserPrincipal,
  tx: Tx,
  input: KeepInTextInput,
): Promise<Result<KeptInText, KeepInTextRefusal>> => {
  const acting = adminOnBinding(principal, input.bindingId);
  if (!acting.ok) return err(acting.error);
  const { admin, workspaceId, bindingId } = acting.value;

  const findingGroups = distinctFindingGroups(input.findingGroups);

  if (findingGroups.some((findingGroup) => findingGroup.tier !== REDACTION_ALWAYS_TIER)) {
    return err("not-the-always-set");
  }

  const standing = await bindingNamed(acting.value, tx, { columns: "1", lock: "for-update" });
  if (!standing.ok) return err(standing.error);

  const held = await attempt(() =>
    tx.query<FindingGroupKey & { readonly id: string }>(FINDINGS_OF_GROUPS, [
      workspaceId,
      bindingId,
      ...findingGroupParameters(findingGroups),
    ]),
  );
  if (!held.ok) return err(held.error);
  const spans = held.value.rows;
  if (
    !findingGroups.every((findingGroup) =>
      spans.some((span) => sameFindingGroup(span, findingGroup)),
    )
  ) {
    return err("no-such-finding");
  }

  const named = spans.map((span) => span.id);
  const batchId = named.length > 1 ? ulid() : undefined;
  for (const findingId of named) {
    const restored = await restoreFinding(admin, tx, {
      findingId,
      reason: input.reason,
      batchId,
    });
    if (!restored.ok) return err(restored.error);
  }
  const reviewed = await attempt(() =>
    tx.query(KEPT_IN_TEXT_REVIEW, [workspaceId, named, KEPT_IN_TEXT]),
  );
  if (!reviewed.ok) return err(reviewed.error);

  const queued = await enqueueJobIn(admin, tx, {
    workspaceId,
    kind: INDEX_KIND,
    subjectId: bindingId,
    reason: "restored",
  });
  if (!queued.ok) {
    throw indexRunRefused(queued.error);
  }
  return ok({ bindingId, findingIds: named, batchId, jobId: queued.value.jobId });
};

const REVIEW_ACTS = declareActs("sources", {
  narrowed: act("sources.document.narrowed", {
    documentId: "id",
    bindingId: "id",
    sensitivity: "sensitivity",
  }),
});

export const narrowDocumentsInput = z.object({
  bindingId: BINDING_ID,

  findingGroups: commandedGroups,

  sensitivity: boundarySchemas.sourceDocument.select.shape.sensitivity
    .unwrap()
    .default(SENSITIVITY_DEFAULT),
});

export type NarrowDocumentsInput = z.output<typeof narrowDocumentsInput>;

export type NarrowDocumentsRefusal =
  | SourceRefusal<"role-forbids" | "no-such-binding" | "no-such-document" | "widening-refused">
  | Error;

export type DocumentsNarrowed = {
  readonly bindingId: string;

  readonly documentIds: readonly string[];
  readonly sensitivity: Sensitivity;

  readonly batchId: string | undefined;

  readonly concepts: readonly string[];

  readonly compositions: readonly string[];
};

const DOCUMENTS_UNDER = `SELECT id, sensitivity FROM source_document
      WHERE workspace_id = $1 AND binding_id = $2 AND id = ANY($3::text[])
      ORDER BY id
        FOR UPDATE`;

type DocumentRow = { readonly id: string; readonly sensitivity: string | null };

const NARROWED = "narrowed" satisfies (typeof FINDING_REVIEW_STATES)[number];

const NARROWED_REVIEW = `UPDATE finding f
        SET review_state = $2, reviewed_by = $3, reviewed_at = now()
       FROM source_document d
      WHERE f.workspace_id = $1 AND f.review_state = $4 AND ${findingGroupClause("f", 5)}
        AND d.workspace_id = f.workspace_id AND d.id = f.document_id
        AND ${raisedByTheLastRun("f", "d")}`;

export const narrowDocuments = async (
  principal: UserPrincipal,
  tx: Tx,
  input: NarrowDocumentsInput,
): Promise<Result<DocumentsNarrowed, NarrowDocumentsRefusal>> => {
  const acting = adminOnBinding(principal, input.bindingId);
  if (!acting.ok) return err(acting.error);
  const { admin, workspaceId, bindingId } = acting.value;

  const next = input.sensitivity;
  const findingGroups = distinctFindingGroups(input.findingGroups);
  const named = [...new Set(findingGroups.map((findingGroup) => findingGroup.documentId))];

  const opened = await openingACascadeOverHeldGroups(admin, tx, []);
  if (!opened.ok) return err(opened.error);

  const binding = await bindingNamed<{ readonly sensitivity: string }>(acting.value, tx, {
    columns: "sensitivity",
    lock: "for-update",
  });
  if (!binding.ok) return err(binding.error);

  const documents = await attempt(() =>
    tx.query<DocumentRow>(DOCUMENTS_UNDER, [workspaceId, bindingId, named]),
  );
  if (!documents.ok) return err(documents.error);
  const rows = documents.value.rows;
  if (rows.length !== named.length) return err("no-such-document");

  for (const row of rows) {
    const effective = effectiveClass(row.sensitivity, binding.value.sensitivity);
    if (effective === undefined) return err(BROKEN_CLASS);
    if (narrower(next, effective) !== next) return err("widening-refused");
  }

  const narrowed = await attempt(() =>
    tx.query(
      `UPDATE source_document SET sensitivity = $4
        WHERE workspace_id = $1 AND binding_id = $2 AND id = ANY($3::text[])`,
      [workspaceId, bindingId, named, next],
    ),
  );
  if (!narrowed.ok) return err(narrowed.error);

  const reviewed = await attempt(() =>
    tx.query(NARROWED_REVIEW, [
      workspaceId,
      NARROWED,
      actorIdOf(admin),
      FINDING_UNREVIEWED_STATE,
      ...findingGroupParameters(findingGroups),
    ]),
  );
  if (!reviewed.ok) return err(reviewed.error);

  const documentIds = rows.map((row) => row.id);
  const batchId = documentIds.length > 1 ? ulid() : undefined;
  for (const documentId of documentIds) {
    await record(admin, tx, {
      id: ulid(),
      act: REVIEW_ACTS.narrowed,
      subjectId: documentId,
      detail: { documentId, bindingId, sensitivity: next },
      batchId,
    });
  }

  const cascaded = await attempt(() => cascadeOverEvidence(admin, tx, { bindingId, documentIds }));
  if (!cascaded.ok) return err(cascaded.error);

  return ok({ bindingId, documentIds, sensitivity: next, batchId, ...cascaded.value });
};
