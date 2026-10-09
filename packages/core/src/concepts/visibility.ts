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
import { action, declareActions, record } from "../audit/index.ts";
import { recomputeWriteUpsIncluding } from "../guides/index.ts";
import {
  actorIdOf,
  attempt,
  attemptResult,
  err,
  isActorId,
  ok,
  requireAdmin,
  ulid,
  type ActorId,
  type AdminUserPrincipal,
  type Principal,
  type Result,
  type RoleRefusal,
  type UserPrincipal,
} from "../kernel/index.ts";
import { holdsEveryGroup } from "../members/index.ts";
import { writeConceptVisibility } from "../store/map/index.ts";
import { scopeClause, scopeParameter, type Tx } from "../store/postgres/index.ts";
import { restsAlsoOnItsReconcilerHit } from "./reconciler-hit.ts";

const VISIBILITY_ACTIONS = declareActions("knowledge", {
  sensitivityOverridden: action("knowledge.concept.class_overridden", {
    iri: "iri",
    sensitivity: "sensitivity",
    audience: "audience",
  }),
});

export type Citation = {
  readonly sourceDocumentId: string;
  readonly locator: string;
};

/** Recomputes no sensitivity: the caller derives it once the citations stand. */
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
       FROM concept_sensitivity_override WHERE workspace_id = ${scopeClause(1)} AND iri = $2`,
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

/**
 * Derives the sensitivity from the connected sources and documents the concept cites, or from `citing` in
 * place of its standing citations. `alsoOn` adds sensitivities, `onTheRow` adds its index row locked
 * for update, and an override wins outright. Share-locks each connected source it reads.
 */
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
             JOIN connected_source b ON b.workspace_id = d.workspace_id AND b.id = d.connected_source_id
            WHERE ce.workspace_id = ${scopeClause(1)} AND ce.iri = $2`,
          parameters: [scopeParameter(principal), concept.iri],
        }
      : {
          clause: `FROM source_document d
             JOIN connected_source b ON b.workspace_id = d.workspace_id AND b.id = d.connected_source_id
            WHERE d.workspace_id = ${scopeClause(1)} AND d.id = ANY($2::text[])`,
          parameters: [scopeParameter(principal), [...new Set(concept.citing)]],
        };
  // A statement that waited on a lock still reads unlocked rows at its first snapshot, so the
  // document's sensitivity is read in the next.
  await tx.query(`SELECT 1 ${rowsCited.clause} FOR SHARE OF b`, rowsCited.parameters);
  const connectedSources = await tx.query<SourcedVisibilityRow>(
    `SELECT b.sensitivity, b.audience, b.audience_groups, d.sensitivity AS document_sensitivity,
            b.published_at IS NOT NULL AS published
       ${rowsCited.clause}`,
    rowsCited.parameters,
  );
  const override = await overrideOf(principal, tx, concept.iri);

  /**
   * After the connected sources, never before: taking this row first is the one order that deadlocks
   * with a narrowing.
   */
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
      ...connectedSources.rows.flatMap(restingOn),
      ...(concept.alsoOn ?? []),
      ...(row?.rows ?? []).map(visibilityOf),
    ],
    fallback: concept.fallback,
    override: override === undefined ? undefined : visibilityOf(override),
  });
};

type IndexVisibilityRow = VisibilityRow & { readonly workspace_id: string; readonly kind: string };

/**
 * Every action that cascades takes this at its head; without it two narrowings each hold what
 * the other wants.
 */
const serialisingCascades = async (principal: Principal, tx: Tx): Promise<void> => {
  await tx.query(
    `SELECT pg_advisory_xact_lock(hashtext('visibility-cascade'), hashtext(${scopeClause(1)}))`,
    [scopeParameter(principal)],
  );
};

/**
 * Row first, citations after, the opposite order to conceptVisibilityFrom: waiting on the row
 * is what makes a re-write's citations the ones read.
 */
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

/**
 * Recomputes each indexed concept citing the connected source's documents, or only those among
 * `documentIds`, and returns every one, whether or not its sensitivity moved.
 */
const recomputeVisibilitySourcedFrom = async (
  principal: Principal,
  tx: Tx,
  input: {
    readonly connectedSourceId: string;
    readonly documentIds?: readonly string[] | undefined;
  },
): Promise<readonly string[]> => {
  const citing = await tx.query<{ iri: string }>(
    `SELECT DISTINCT ce.iri
       FROM concept_evidence ce
       JOIN source_document d ON d.workspace_id = ce.workspace_id AND d.id = ce.source_document_id
      WHERE ce.workspace_id = ${scopeClause(1)} AND d.connected_source_id = $2
        AND ($3::text[] IS NULL OR d.id = ANY($3::text[]))
      ORDER BY ce.iri`,
    [scopeParameter(principal), input.connectedSourceId, input.documentIds ?? null],
  );
  const recomputed: string[] = [];
  for (const { iri } of citing.rows) {
    const visibility = await recomputeConceptVisibility(principal, tx, iri);
    if (visibility !== undefined) recomputed.push(iri);
  }
  return recomputed;
};

/**
 * The concepts citing a connected source's documents, all of them or only `documentIds`, or the one
 * concept an override names.
 */
type CascadeTarget =
  | {
      readonly connectedSourceId: string;
      readonly documentIds?: readonly string[] | undefined;
    }
  | { readonly iri: string };

type Cascaded<T> = {
  readonly written: T;

  readonly concepts: readonly string[];

  readonly writeUps: readonly string[];
};

const conceptsRecomputed = async (
  principal: Principal,
  tx: Tx,
  target: CascadeTarget,
): Promise<readonly string[]> => {
  if (!("iri" in target)) return recomputeVisibilitySourcedFrom(principal, tx, target);
  await recomputeConceptVisibility(principal, tx, target.iri);
  return [target.iri];
};

const rederived = async (principal: Principal, tx: Tx, target: CascadeTarget) => {
  const concepts = await conceptsRecomputed(principal, tx, target);
  const writeUps = await recomputeWriteUpsIncluding(principal, tx, { iris: concepts });
  return { concepts, writeUps };
};

/**
 * Takes the workspace's cascade lock, runs `write`, then recomputes the target's concepts and every
 * write-up including them. A refusal from `write` comes back as it is, with nothing recomputed. The
 * caller's own checks belong inside `write`, after the lock and before any row it locks.
 */
export const cascadingVisibility = async <T, E>(
  principal: Principal,
  tx: Tx,
  target: CascadeTarget,
  write: (tx: Tx) => Promise<Result<T, E>>,
): Promise<Result<Cascaded<T>, E | Error>> => {
  const serialised = await attempt(() => serialisingCascades(principal, tx));
  if (!serialised.ok) return err(serialised.error);
  const written = await write(tx);
  if (!written.ok) return err(written.error);
  const cascaded = await attempt(() => rederived(principal, tx, target));
  if (!cascaded.ok) return err(cascaded.error);
  return ok({ written: written.value, ...cascaded.value });
};

export type OverrideConceptSensitivityInput = {
  readonly iri: string;
  readonly sensitivity: string;
  readonly audience: string;

  readonly audienceGroups?: readonly string[] | null | undefined;
};

export type OverrideConceptSensitivityRefusal =
  | RoleRefusal
  | "malformed"
  | "no-such-concept"
  | "no-such-group"
  | Error;

export type ConceptSensitivityOverridden = {
  readonly iri: string;
  readonly auditEventId: string;

  readonly visibility: Visibility;

  readonly writeUps: readonly string[];
};

const OVERRIDE_IRI = boundarySchemas.conceptSensitivityOverride.insert.shape.iri;

/** Admin only. `writeUps` names every write-up including the concept, each recomputed. */
export const overrideConceptSensitivity = async (
  principal: UserPrincipal,
  tx: Tx,
  input: OverrideConceptSensitivityInput,
): Promise<Result<ConceptSensitivityOverridden, OverrideConceptSensitivityRefusal>> => {
  const admin = requireAdmin(principal);
  if (!admin.ok) return err(admin.error);
  const iri = OVERRIDE_IRI.safeParse(input.iri);
  const visibility = visibilityFrom(input);
  if (!iri.success || visibility === undefined) return err("malformed");

  const cascaded = await cascadingVisibility(admin.value, tx, { iri: iri.data }, (tx) =>
    writeOverride(admin.value, tx, iri.data, visibility),
  );
  if (!cascaded.ok) return err(cascaded.error);
  return ok({ ...cascaded.value.written, writeUps: cascaded.value.writeUps });
};

const openingTheOverride = async (
  admin: AdminUserPrincipal,
  tx: Tx,
  iri: string,
  visibility: Visibility,
): Promise<Result<undefined, OverrideConceptSensitivityRefusal>> => {
  const groups = await attemptResult(() =>
    holdsEveryGroup(admin, tx, visibility.audienceGroups ?? []),
  );
  if (!groups.ok) return err(groups.error);
  const known = await attempt(() =>
    tx.query("SELECT 1 FROM concept_identity WHERE workspace_id = $1 AND iri = $2", [
      admin.workspaceId,
      iri,
    ]),
  );
  if (!known.ok) return err(known.error);
  if (known.value.rowCount === 0) return err("no-such-concept");
  if (!groups.value) return err("no-such-group");
  return ok(undefined);
};

const writeOverride = async (
  admin: AdminUserPrincipal,
  tx: Tx,
  iri: string,
  visibility: Visibility,
): Promise<
  Result<Omit<ConceptSensitivityOverridden, "writeUps">, OverrideConceptSensitivityRefusal>
> => {
  const opened = await openingTheOverride(admin, tx, iri, visibility);
  if (!opened.ok) return err(opened.error);
  const auditEventId = ulid();
  const recorded = await attempt(() =>
    tx.query(
      `INSERT INTO concept_sensitivity_override
         (workspace_id, iri, sensitivity, audience, audience_groups, actor, audit_event_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (workspace_id, iri) DO UPDATE
          SET sensitivity = EXCLUDED.sensitivity, audience = EXCLUDED.audience,
              audience_groups = EXCLUDED.audience_groups, actor = EXCLUDED.actor,
              audit_event_id = EXCLUDED.audit_event_id, recorded_at = now()`,
      [
        admin.workspaceId,
        iri,
        visibility.sensitivity,
        visibility.audience,
        visibility.audienceGroups,
        actorIdOf(admin),
        auditEventId,
      ],
    ),
  );
  if (!recorded.ok) return err(recorded.error);

  await record(admin, tx, {
    id: auditEventId,
    action: VISIBILITY_ACTIONS.sensitivityOverridden,
    subjectId: iri,
    detail: { iri, sensitivity: visibility.sensitivity, audience: visibility.audience },
  });
  return ok({ iri, auditEventId, visibility });
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

const PANE_WORDS = {
  "nothing-cited": { lead: PANE_COPY.nothingCited, next: PANE_COPY.nextWhenNothingCited },
  included: { lead: PANE_COPY.included, next: PANE_COPY.nextWhenIncluded },
  "partly-included": { lead: PANE_COPY.partlyIncluded, next: PANE_COPY.nextWhenWithheld },
  "not-included": { lead: PANE_COPY.notIncluded, next: PANE_COPY.nextWhenWithheld },
} as const satisfies Record<
  EvidencePane["access"] | "nothing-cited",
  { readonly lead: string; readonly next: string }
>;

/** `actor` and `recorded_at` are null together: no override row joined. */
type PaneFacts = {
  readonly cited: number;

  readonly readable: readonly ReadableEvidence[];
} & (
  | { readonly actor: null; readonly recorded_at: null }
  | { readonly actor: string; readonly recorded_at: Date }
);

/** `undefined` when the principal cannot read the concept, or no concept has the IRI. */
export const evidencePaneOf = async (
  principal: UserPrincipal,
  tx: Tx,
  iri: string,
): Promise<Result<EvidencePane | undefined, Error>> => {
  // One statement, so one snapshot: reads taken apart can straddle a re-write's commit.
  const read = await attempt(() =>
    tx.query<PaneFacts>(
      `SELECT count(ce.locator)::int AS cited,
              coalesce(
                json_agg(json_build_object('locator', ce.locator, 'resource', e.resource)
                         ORDER BY ce.locator, ce.source_document_id)
                  FILTER (WHERE e.resource IS NOT NULL),
                '[]') AS readable,
              o.actor, o.recorded_at
         FROM concept_index c
         LEFT JOIN concept_sensitivity_override o ON o.workspace_id = c.workspace_id AND o.iri = c.iri
         LEFT JOIN concept_evidence ce ON ce.workspace_id = c.workspace_id AND ce.iri = c.iri
         LEFT JOIN (evidence e
                    JOIN source_document d
                      ON d.workspace_id = e.workspace_id AND d.id = e.source_document_id
                    JOIN connected_source b ON b.workspace_id = d.workspace_id AND b.id = d.connected_source_id)
                ON e.workspace_id = ce.workspace_id AND e.source_document_id = ce.source_document_id
               AND e.locator = ce.locator AND ${readableClause("b", 3)}
        WHERE c.workspace_id = $1 AND c.iri = $2 AND ${readableClause("c", 3)}
        GROUP BY c.iri, o.actor, o.recorded_at`,
      [principal.workspaceId, iri, ...readableParameters(principal)],
    ),
  );
  if (!read.ok) return err(read.error);
  const [facts] = read.value.rows;
  return ok(facts === undefined ? undefined : paneOf(facts));
};

const paneOf = (facts: PaneFacts): EvidencePane => {
  const withheld = facts.cited - facts.readable.length;
  const access =
    withheld === 0 ? "included" : facts.readable.length === 0 ? "not-included" : "partly-included";
  const sharedBeyondEvidence = withheld > 0 ? sharerOf(facts) : undefined;
  const { lead, next } =
    PANE_WORDS[access === "included" && facts.cited === 0 ? "nothing-cited" : access];
  return {
    access,
    lead: sharedBeyondEvidence === undefined ? lead : `${lead} ${PANE_COPY.sharedBeyondEvidence}`,
    evidence: facts.readable,
    sharedBeyondEvidence,
    next,
  };
};

const sharerOf = ({ actor, recorded_at }: PaneFacts): EvidencePane["sharedBeyondEvidence"] =>
  actor !== null && isActorId(actor) ? { by: actor, at: recorded_at } : undefined;
