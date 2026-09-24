import { boundarySchemas } from "@better-answers/schema";

import {
  derivedVisibility,
  readableClause,
  readableParameters,
  RESTRICTED_TO_ADMINS,
  visibilityFrom,
  visibilityOf,
  type Visibility,
  type VisibilityRow,
} from "../access/index.ts";
import { act, declareActs, record } from "../audit/index.ts";
import {
  actorIdOf,
  attempt,
  err,
  isActorId,
  ok,
  requireAdmin,
  ulid,
  type ActorId,
  type AdminUserPrincipal,
  type GroupId,
  type Principal,
  type Result,
  type RoleRefusal,
  type UserPrincipal,
} from "../kernel/index.ts";
import { recomputeCompositionsIncluding } from "../guides/index.ts";
import { holdsEveryGroup } from "../members/index.ts";
import { writeConceptVisibility } from "../store/graph/index.ts";
import { scopeClause, scopeParameter, type Tx } from "../store/postgres/index.ts";
import { restsAlsoOnItsReconcilerHit } from "./reconciler-hit.ts";

const VISIBILITY_ACTS = declareActs("knowledge", {
  classOverridden: act("knowledge.concept.class_overridden", {
    iri: "iri",
    sensitivity: "sensitivity",
    audience: "audience",
  }),
});

export type Citation = {
  readonly sourceDocumentId: string;
  readonly locator: string;
};

export const replaceCitations = async (
  principal: Principal,
  tx: Tx,
  iri: string,
  citations: readonly Citation[],
): Promise<void> => {
  await tx.query(
    `DELETE FROM concept_evidence WHERE workspace_id = ${scopeClause(1)} AND iri = $2`,
    [scopeParameter(principal), iri],
  );
  for (const citation of citations) {
    await tx.query(
      `INSERT INTO concept_evidence (workspace_id, iri, source_document_id, locator)
       VALUES (${scopeClause(1)}, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [scopeParameter(principal), iri, citation.sourceDocumentId, citation.locator],
    );
  }
};

type OverrideRow = VisibilityRow & { readonly actor: string; readonly recorded_at: Date };

const overrideOf = async (
  principal: Principal,
  tx: Tx,
  iri: string,
): Promise<OverrideRow | undefined> => {
  const found = await tx.query<OverrideRow>(
    `SELECT sensitivity, audience, audience_groups, actor, recorded_at
       FROM concept_class_override WHERE workspace_id = ${scopeClause(1)} AND iri = $2`,
    [scopeParameter(principal), iri],
  );
  return found.rows[0];
};

type SourcedVisibilityRow = VisibilityRow & {
  readonly document_sensitivity: string | null;
  readonly published: boolean;
};

const restingOn = (row: SourcedVisibilityRow): readonly Visibility[] => [
  visibilityOf(row),
  ...(row.document_sensitivity === null
    ? []
    : [visibilityOf({ ...row, sensitivity: row.document_sensitivity })]),
  ...(row.published ? [] : [RESTRICTED_TO_ADMINS]),
];

export const conceptVisibilityFrom = async (
  principal: Principal,
  tx: Tx,
  concept: {
    readonly iri: string;
    readonly kind: string;
    readonly fallback: Visibility;

    readonly citing?: readonly string[] | undefined;

    readonly alsoOn?: readonly Visibility[] | undefined;

    readonly onTheRow?: boolean | undefined;
  },
): Promise<Visibility> => {
  const rowsCited =
    concept.citing === undefined
      ? {
          clause: `FROM concept_evidence ce
             JOIN source_document d ON d.workspace_id = ce.workspace_id AND d.id = ce.source_document_id
             JOIN source_binding b ON b.workspace_id = d.workspace_id AND b.id = d.binding_id
            WHERE ce.workspace_id = ${scopeClause(1)} AND ce.iri = $2`,
          parameters: [scopeParameter(principal), concept.iri],
        }
      : {
          clause: `FROM source_document d
             JOIN source_binding b ON b.workspace_id = d.workspace_id AND b.id = d.binding_id
            WHERE d.workspace_id = ${scopeClause(1)} AND d.id = ANY($2::text[])`,
          parameters: [scopeParameter(principal), [...new Set(concept.citing)]],
        };
  // A statement that waited on a lock still reads unlocked rows at its first snapshot, so the
  // document's class is read in the next.
  await tx.query(`SELECT 1 ${rowsCited.clause} FOR SHARE OF b`, rowsCited.parameters);
  const bindings = await tx.query<SourcedVisibilityRow>(
    `SELECT b.sensitivity, b.audience, b.audience_groups, d.sensitivity AS document_sensitivity,
            b.published_at IS NOT NULL AS published
       ${rowsCited.clause}`,
    rowsCited.parameters,
  );
  const override = await overrideOf(principal, tx, concept.iri);

  // After the bindings, never before: taking this row first is the one order that deadlocks
  // with a narrowing.
  const row =
    concept.onTheRow === true
      ? await tx.query<VisibilityRow>(
          `SELECT sensitivity, audience, audience_groups FROM concept_index
            WHERE workspace_id = ${scopeClause(1)} AND iri = $2 FOR UPDATE`,
          [scopeParameter(principal), concept.iri],
        )
      : undefined;
  return derivedVisibility({
    kind: concept.kind,
    from: [
      ...bindings.rows.flatMap(restingOn),
      ...(concept.alsoOn ?? []),
      ...(row?.rows ?? []).map(visibilityOf),
    ],
    fallback: concept.fallback,
    override: override === undefined ? undefined : visibilityOf(override),
  });
};

type IndexVisibilityRow = VisibilityRow & { readonly workspace_id: string; readonly kind: string };

// Every act that cascades takes this at its head; without it two narrowings each hold what
// the other wants.
const serialisingCascades = async (principal: Principal, tx: Tx): Promise<void> => {
  await tx.query(
    `SELECT pg_advisory_xact_lock(hashtext('visibility-cascade'), hashtext(${scopeClause(1)}))`,
    [scopeParameter(principal)],
  );
};

export const openingACascadeOverHeldGroups = async (
  admin: AdminUserPrincipal,
  tx: Tx,
  groupIds: readonly GroupId[],
): Promise<Result<boolean, RoleRefusal | Error>> => {
  const serialised = await attempt(() => serialisingCascades(admin, tx));
  if (!serialised.ok) return err(serialised.error);
  const groups = await attempt(() => holdsEveryGroup(admin, tx, groupIds));
  if (!groups.ok) return err(groups.error);
  return groups.value;
};

// Row first, citations after, the opposite order to conceptVisibilityFrom: waiting on the row
// is what makes a re-write's citations the ones read.
const recomputeConceptVisibility = async (
  principal: Principal,
  tx: Tx,
  iri: string,
): Promise<Visibility | undefined> => {
  const held = await tx.query<IndexVisibilityRow>(
    `SELECT workspace_id, kind, sensitivity, audience, audience_groups FROM concept_index
      WHERE workspace_id = ${scopeClause(1)} AND iri = $2 FOR UPDATE`,
    [scopeParameter(principal), iri],
  );
  const row = held.rows[0];
  if (row === undefined) return undefined;
  const visibility = await conceptVisibilityFrom(principal, tx, {
    iri,
    kind: row.kind,
    fallback: visibilityOf(row),
    alsoOn: await restsAlsoOnItsReconcilerHit(principal, tx, iri),
  });
  await tx.query(
    `UPDATE concept_index SET sensitivity = $3, audience = $4, audience_groups = $5, updated_at = now()
      WHERE workspace_id = $1 AND iri = $2`,
    [row.workspace_id, iri, visibility.sensitivity, visibility.audience, visibility.audienceGroups],
  );
  await writeConceptVisibility(principal, tx, {
    workspaceId: row.workspace_id,
    iri,
    ...visibility,
  });
  return visibility;
};

export const recomputeVisibilitySourcedFrom = async (
  principal: Principal,
  tx: Tx,
  input: { readonly bindingId: string; readonly documentIds?: readonly string[] | undefined },
): Promise<readonly string[]> => {
  const citing = await tx.query<{ iri: string }>(
    `SELECT DISTINCT ce.iri
       FROM concept_evidence ce
       JOIN source_document d ON d.workspace_id = ce.workspace_id AND d.id = ce.source_document_id
      WHERE ce.workspace_id = ${scopeClause(1)} AND d.binding_id = $2
        AND ($3::text[] IS NULL OR d.id = ANY($3::text[]))
      ORDER BY ce.iri`,
    [scopeParameter(principal), input.bindingId, input.documentIds ?? null],
  );
  const moved: string[] = [];
  for (const { iri } of citing.rows) {
    const visibility = await recomputeConceptVisibility(principal, tx, iri);
    if (visibility !== undefined) moved.push(iri);
  }
  return moved;
};

export type OverrideConceptClassInput = {
  readonly iri: string;
  readonly sensitivity: string;
  readonly audience: string;

  readonly audienceGroups?: readonly string[] | null | undefined;
};

export type OverrideConceptClassRefusal =
  | RoleRefusal
  | "malformed"
  | "no-such-concept"
  | "no-such-group"
  | Error;

export type ConceptClassOverridden = {
  readonly iri: string;
  readonly auditEventId: string;

  readonly visibility: Visibility;

  readonly compositions: readonly string[];
};

const OVERRIDE_IRI = boundarySchemas.conceptClassOverride.insert.shape.iri;

export const overrideConceptClass = async (
  principal: UserPrincipal,
  tx: Tx,
  input: OverrideConceptClassInput,
): Promise<Result<ConceptClassOverridden, OverrideConceptClassRefusal>> => {
  const admin = requireAdmin(principal);
  if (!admin.ok) return err(admin.error);
  const iri = OVERRIDE_IRI.safeParse(input.iri);
  const visibility = visibilityFrom(input);
  if (!iri.success || visibility === undefined) return err("malformed");
  const { workspaceId } = admin.value;

  const groups = await openingACascadeOverHeldGroups(
    admin.value,
    tx,
    visibility.audienceGroups ?? [],
  );
  if (!groups.ok) return err(groups.error);
  const known = await attempt(() =>
    tx.query("SELECT 1 FROM concept_identity WHERE workspace_id = $1 AND iri = $2", [
      workspaceId,
      iri.data,
    ]),
  );
  if (!known.ok) return err(known.error);
  if (known.value.rowCount === 0) return err("no-such-concept");
  if (!groups.value) return err("no-such-group");

  const auditEventId = ulid();
  const recorded = await attempt(() =>
    tx.query(
      `INSERT INTO concept_class_override
         (workspace_id, iri, sensitivity, audience, audience_groups, actor, audit_event_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (workspace_id, iri) DO UPDATE
          SET sensitivity = EXCLUDED.sensitivity, audience = EXCLUDED.audience,
              audience_groups = EXCLUDED.audience_groups, actor = EXCLUDED.actor,
              audit_event_id = EXCLUDED.audit_event_id, recorded_at = now()`,
      [
        workspaceId,
        iri.data,
        visibility.sensitivity,
        visibility.audience,
        visibility.audienceGroups,
        actorIdOf(admin.value),
        auditEventId,
      ],
    ),
  );
  if (!recorded.ok) return err(recorded.error);

  await record(admin.value, tx, {
    id: auditEventId,
    act: VISIBILITY_ACTS.classOverridden,
    subjectId: iri.data,
    detail: { iri: iri.data, sensitivity: visibility.sensitivity, audience: visibility.audience },
  });
  const cascaded = await attempt(async () => {
    await recomputeConceptVisibility(admin.value, tx, iri.data);
    return recomputeCompositionsIncluding(admin.value, tx, { iris: [iri.data] });
  });
  if (!cascaded.ok) return err(cascaded.error);
  return ok({ iri: iri.data, auditEventId, visibility, compositions: cascaded.value });
};

type ReadableEvidence = {
  readonly locator: string;

  readonly resource: string;
};

export type EvidencePane = {
  readonly access: "included" | "partly-included" | "not-included";

  readonly lead: string;

  readonly evidence: readonly ReadableEvidence[];

  readonly sharedBeyondEvidence: { readonly by: ActorId; readonly at: Date } | undefined;

  readonly next: string;
};

const PANE_COPY = {
  nothingCited: "This concept cites no source, so there is nothing to include.",
  included: "Based on your current access, the evidence is included.",
  partlyIncluded: "Based on your current access, some of the evidence isn't included.",
  notIncluded: "Based on your current access, the evidence isn't included.",
  sharedBeyondEvidence: "An Admin shared this concept beyond its evidence.",
  nextWhenIncluded: "Open a source to read the passage the concept rests on.",
  nextWhenWithheld: "Ask an Admin for access to the sources, or read the concept as it stands.",
  nextWhenNothingCited: "Read the concept as it stands.",
} as const;

export const evidencePaneOf = async (
  principal: UserPrincipal,
  tx: Tx,
  iri: string,
): Promise<Result<EvidencePane | undefined, Error>> => {
  const parameters = readableParameters(principal);
  const read = await attempt(async () => {
    const concept = await tx.query(
      `SELECT 1 FROM concept_index c WHERE c.workspace_id = $1 AND c.iri = $2 AND ${readableClause("c", 3)}`,
      [principal.workspaceId, iri, ...parameters],
    );
    if (concept.rowCount === 0) return undefined;
    const cited = await tx.query<{ cited: number }>(
      "SELECT count(*)::int AS cited FROM concept_evidence WHERE workspace_id = $1 AND iri = $2",
      [principal.workspaceId, iri],
    );
    const readable = await tx.query<ReadableEvidence>(
      `SELECT ce.locator, e.resource
         FROM concept_evidence ce
         JOIN evidence e ON e.workspace_id = ce.workspace_id
                        AND e.source_document_id = ce.source_document_id AND e.locator = ce.locator
         JOIN source_document d ON d.workspace_id = ce.workspace_id AND d.id = ce.source_document_id
         JOIN source_binding b ON b.workspace_id = d.workspace_id AND b.id = d.binding_id
        WHERE ce.workspace_id = $1 AND ce.iri = $2 AND ${readableClause("b", 3)}
        ORDER BY ce.locator, ce.source_document_id`,
      [principal.workspaceId, iri, ...parameters],
    );
    return {
      cited: cited.rows[0]?.cited ?? 0,
      readable: readable.rows,
      override: await overrideOf(principal, tx, iri),
    };
  });
  if (!read.ok) return err(read.error);
  if (read.value === undefined) return ok(undefined);
  return ok(paneOf(read.value));
};

const paneOf = (facts: {
  readonly cited: number;
  readonly readable: readonly ReadableEvidence[];
  readonly override: OverrideRow | undefined;
}): EvidencePane => {
  const withheld = facts.cited - facts.readable.length;
  const access =
    withheld === 0 ? "included" : facts.readable.length === 0 ? "not-included" : "partly-included";
  const sharedBeyondEvidence =
    withheld > 0 && facts.override !== undefined && isActorId(facts.override.actor)
      ? { by: facts.override.actor, at: facts.override.recorded_at }
      : undefined;
  const lead =
    access === "included"
      ? facts.cited === 0
        ? PANE_COPY.nothingCited
        : PANE_COPY.included
      : access === "partly-included"
        ? PANE_COPY.partlyIncluded
        : PANE_COPY.notIncluded;
  return {
    access,
    lead: sharedBeyondEvidence === undefined ? lead : `${lead} ${PANE_COPY.sharedBeyondEvidence}`,
    evidence: facts.readable,
    sharedBeyondEvidence,
    next:
      access === "included"
        ? facts.cited === 0
          ? PANE_COPY.nextWhenNothingCited
          : PANE_COPY.nextWhenIncluded
        : PANE_COPY.nextWhenWithheld,
  };
};
