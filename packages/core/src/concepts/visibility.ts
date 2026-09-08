import { boundarySchemas } from "@better-answers/schema";

import {
  derivedVisibility,
  readableClause,
  readableParameters,
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

/**
 * The concepts slice's half of *who may see this* (ADR 0023, ADR 0039; T-006 spec,
 * *Visibility derivation and audience*): a concept's class is derived from **the bindings
 * of the evidence it cites** — the most restrictive class, the audiences' intersection with
 * *everyone* as the identity, an empty intersection forcing Restricted, the per-kind floor
 * never widened past, a recorded Admin override outranking all of it — and written to the
 * index row and to the map's copies of it in the same transaction, so the walk never forks
 * from `concept_index`. The rules themselves are `access`'s; this module is where they
 * meet the rows.
 *
 * Three roads reach the derivation. The governed write runs it as it lands the row
 * (`landRows`), so a concept is never readable for an instant at a class its evidence does
 * not allow. A narrowing of a binding (`sources.narrowBinding`) recomputes every concept
 * citing that binding's documents through `recomputeVisibilitySourcedFrom`, then every
 * composition including those concepts through the guides slice — synchronously, inside
 * the narrowing act's own transaction, two levels (ADR 0023: a queue reopens the leak for
 * the length of the queue). And an Admin's override (`overrideConceptClass`) is the one act
 * that may widen: a recorded act, an audit event and a row, creating the state the
 * glossary calls **shared beyond its evidence** — which the evidence pane
 * (`evidencePaneOf`) says in so many words, leading with the reader's access, naming the
 * Admin, and never dead-ending.
 *
 * The binding a citation resolves to is reached through the **document row the platform
 * recorded**, never through a binding id a producer could supply beside its citation: a
 * caller that could name the binding could name a Public one for a Restricted document
 * and widen a class by asserting it (`source-tables.ts`).
 */

/**
 * The override act (ADR 0023: only a recorded Admin override may widen past what the
 * evidence and the floor derive). The subject is the concept, by IRI, and the detail says
 * what the Admin decided in the glossary's own words — never a rider, never a trust signal.
 */
const VISIBILITY_ACTS = declareActs("knowledge", {
  classOverridden: act("knowledge.concept.class_overridden", {
    iri: "iri",
    sensitivity: "sensitivity",
    audience: "audience",
  }),
});

/** One citation as the governed write is handed it: the evidence's own key. */
export type Citation = {
  readonly sourceDocumentId: string;
  readonly locator: string;
};

/**
 * The concept's citations, replaced whole from the evidence the act was handed — which is
 * the only reader of what a concept cites: the file's `sources[]` is a projection with no
 * document id in it (`concept-tables.ts`, *concept_evidence*), so a second reader over the
 * file would be a second opinion about the relation the derivation depends on.
 */
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

/** A recorded override as the pane names it: who, when, and what they decided. */
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

/**
 * What one concept's visibility derives to, from the rows as they stand: the bindings its
 * citations resolve to through the catalogue, the override if one is recorded, the kind's
 * floor, and — when nothing it cites resolves to a binding — the fallback the caller holds,
 * which is the writer's word on a creation and what the row holds now on anything else. A
 * citation whose document the catalogue does not hold contributes no binding: it cannot
 * widen, because it derives nothing, and it cannot narrow, because there is nothing to
 * narrow by.
 *
 * The citations are the concept's standing rows, or — when the caller names `citing` — the
 * documents a write is *about to* cite, so the governed write can ask **before it commits**
 * what its new evidence would derive and refuse a widening while a refusal still costs no
 * commit. One derivation either way: the same bindings, the same override, the same floor.
 *
 * The binding rows are read `FOR SHARE`. Under READ COMMITTED a plain read beside an open
 * narrowing sees the binding as it was, derives the wider class, and commits after the
 * narrowing whose cascade never saw this concept's citation — a concept citing a Restricted
 * binding at Internal until the next recompute. The share lock makes the derivation wait
 * for a narrowing in flight, and holds the narrowing's own `FOR UPDATE` read
 * (`sources.narrowBinding`) behind a derivation in flight, so the two orders are the only
 * two: the write derives from the narrowed binding, or the cascade recomputes the write.
 *
 * That share lock covers the bindings the concept cites **after** the act. A re-write that
 * swaps its evidence is a third order: a narrowing of the binding its *old* citations rested
 * on can cascade to the concept's row between the write's pre-commit check — which read the
 * row wider, and refused no widening — and its landing, whose derivation over the new
 * bindings never touches the narrowed one. So a landing asks for the row too (`onTheRow`):
 * the pair `concept_index` holds at that instant, read `FOR UPDATE` after the bindings so a
 * narrowing in flight is waited for and never deadlocked with, and combined as one more unit
 * the concept rests on — the class the most restrictive, the audience the intersection — by
 * the same rule, so a recorded override still outranks it and the floor still applies. A
 * re-write thus never lands wider than the row it re-writes, at whichever instant the
 * widening would have slipped through; a creation has no row and rests on nothing here.
 */
export const conceptVisibilityFrom = async (
  principal: Principal,
  tx: Tx,
  concept: {
    readonly iri: string;
    readonly kind: string;
    readonly fallback: Visibility;
    /** The document ids to derive from instead of the standing citations, when a write asks ahead. */
    readonly citing?: readonly string[] | undefined;
    /**
     * Units the concept rests on beside its bindings — the replay's fail-closed answer when
     * the file's sources are not the standing citations (`RESTRICTED_TO_ADMINS`), combined by
     * the one rule so a recorded override still outranks it and the floor still applies.
     */
    readonly alsoOn?: readonly Visibility[] | undefined;
    /**
     * Rest on the pair the concept's own row holds at this instant too, read and held
     * `FOR UPDATE` in this transaction — the landing's clamp against a cascade that narrowed
     * the row between an act's check and its rows.
     */
    readonly onTheRow?: boolean | undefined;
  },
): Promise<Visibility> => {
  const bindings =
    concept.citing === undefined
      ? await tx.query<VisibilityRow>(
          `SELECT b.sensitivity, b.audience, b.audience_groups
             FROM concept_evidence ce
             JOIN source_document d ON d.workspace_id = ce.workspace_id AND d.id = ce.source_document_id
             JOIN source_binding b ON b.workspace_id = d.workspace_id AND b.id = d.binding_id
            WHERE ce.workspace_id = ${scopeClause(1)} AND ce.iri = $2
            FOR SHARE OF b`,
          [scopeParameter(principal), concept.iri],
        )
      : await tx.query<VisibilityRow>(
          `SELECT b.sensitivity, b.audience, b.audience_groups
             FROM source_document d
             JOIN source_binding b ON b.workspace_id = d.workspace_id AND b.id = d.binding_id
            WHERE d.workspace_id = ${scopeClause(1)} AND d.id = ANY($2::text[])
            FOR SHARE OF b`,
          [scopeParameter(principal), [...new Set(concept.citing)]],
        );
  const override = await overrideOf(principal, tx, concept.iri);
  // After the bindings, never before: a narrowing holds its binding and then wants this row,
  // and taking the row first would be the one order that deadlocks with it.
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
      ...bindings.rows.map(visibilityOf),
      ...(concept.alsoOn ?? []),
      ...(row?.rows ?? []).map(visibilityOf),
    ],
    fallback: concept.fallback,
    override: override === undefined ? undefined : visibilityOf(override),
  });
};

type IndexVisibilityRow = VisibilityRow & { readonly workspace_id: string; readonly kind: string };

/**
 * **The lock every act that cascades takes at its head**, before it reads or holds any row:
 * one transaction-scoped advisory lock per workspace, so a narrowing and an override in one
 * workspace run one after the other and never beside each other.
 *
 * Without it two narrowings deadlock. Each holds its own binding `FOR UPDATE` and then, for a
 * concept citing both bindings, asks `conceptVisibilityFrom` for the other `FOR SHARE` — two
 * acts each holding what the other wants, which Postgres resolves by aborting one of them
 * with an error an Admin cannot act on. Locking every binding a cascade could reach in one
 * deterministic order would need the cascade's whole closure read before the act begins;
 * one lock per workspace is the same serialisation in one statement, and the acts that take
 * it are an Admin's few. The governed write does not take it: its derivation holds bindings
 * `FOR SHARE` and then its own row, the orders analysed in `conceptVisibilityFrom`, and a
 * write beside a cascade waits on a row rather than deadlocking with it.
 */
const serialisingCascades = async (principal: Principal, tx: Tx): Promise<void> => {
  await tx.query(
    `SELECT pg_advisory_xact_lock(hashtext('visibility-cascade'), hashtext(${scopeClause(1)}))`,
    [scopeParameter(principal)],
  );
};

/**
 * The head every act that writes an audience shares, and **what it answers is
 * `holdsEveryGroup`'s question**: whether the workspace holds every group the act names —
 * `true` when it does, `false` when the audience names a group nobody minted — asked only
 * once the workspace's cascade lock is held (`serialisingCascades`). Answered as one `Result`
 * so the two acts read one gate and not two copies of it; what each then reads of its own
 * rows — the binding, the concept — is its own. `holdsEveryGroup` asks `requireAdmin` of a
 * principal this signature already narrowed: that check is the members door's own contract,
 * refused to anyone else and tested there, and it is a role comparison, not a read.
 */
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

/**
 * One concept re-derived from the rows as they stand and rewritten — the index row and,
 * through the graph door, the map's copies of it — in the caller's transaction. What the
 * row holds now is the fallback, so a concept whose citations no longer resolve keeps its
 * class rather than taking a default nobody decided. The graph door is handed the row's
 * own workspace, which is what its copies carry.
 *
 * **The row is taken `FOR UPDATE` first, and the citations are read after.** A re-write in
 * flight holds this row while it lands, and may have changed what the concept cites — dropped
 * the very citation this cascade is recomputing for. A cascade that read the citations first
 * and waited on the row afterwards would then overwrite the re-write's newer visibility with
 * one derived from evidence the concept no longer cites; waiting on the row first means what
 * this reads is what the re-write left. Row-first is safe here and not in the write's own
 * derivation because the acts that reach this hold `serialisingCascades`: the one other act
 * that takes a binding `FOR UPDATE` and then wants a row is another cascade, and no two run
 * at once.
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
 * The cascade's first level: every concept citing evidence from one binding's documents,
 * re-derived and rewritten in the caller's transaction — the narrowing act's — and its
 * IRIs answered, so the act can carry them to the second level. Takes the transaction
 * rather than a door, so a failure aborts the act (the kernel's result convention, rule
 * 5): a recompute that half-landed would be exactly the leak the synchronous rule closes.
 */
export const recomputeVisibilitySourcedFrom = async (
  principal: Principal,
  tx: Tx,
  input: { readonly bindingId: string },
): Promise<readonly string[]> => {
  const citing = await tx.query<{ iri: string }>(
    `SELECT DISTINCT ce.iri
       FROM concept_evidence ce
       JOIN source_document d ON d.workspace_id = ce.workspace_id AND d.id = ce.source_document_id
      WHERE ce.workspace_id = ${scopeClause(1)} AND d.binding_id = $2
      ORDER BY ce.iri`,
    [scopeParameter(principal), input.bindingId],
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
  /** The named groups when the audience is *groups*; `null` or absent for *everyone*. */
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
  /** What the concept's rows now hold — the override, since it outranks everything. */
  readonly visibility: Visibility;
  /** The compositions the second level of the cascade rewrote. */
  readonly compositions: readonly string[];
};

const OVERRIDE_IRI = boundarySchemas.conceptClassOverride.insert.shape.iri;

/**
 * The one act that may widen a concept's class past what its evidence and its kind's
 * floor derive (ADR 0023) — an Admin's, recorded as an audit event and a row, so the
 * evidence pane can name who created the *shared beyond its evidence* state. One standing
 * override per concept: a later one replaces it. The concept's rows are re-derived in the
 * same transaction, and every composition including it follows, so the override is the
 * whole of what a reader sees the moment it commits.
 *
 * It refuses an Editor, a shape that is not a visibility, a concept this workspace never
 * minted and a group it does not hold — each before any row is written. The ledger row
 * is written after the override row and **bare**: its rejection aborts the transaction the
 * row landed in (ADR 0014 rule 4).
 */
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

  // At the head, before any row is read: an override cascades, and cascades in one
  // workspace run one after the other (`serialisingCascades`).
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
  // Bare, after the row: the door's rejection aborts the transaction the row landed in.
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

/** One piece of cited evidence this reader may open. */
export type ReadableEvidence = {
  readonly locator: string;
  /** The rendered projection off the document — what a reader is shown (`CONTEXT.md`, *evidence*). */
  readonly resource: string;
};

/**
 * The evidence pane's read (`CONTEXT.md`, *shared beyond its evidence*): what a reader who
 * may see the concept may see of what it rests on. **The routing is fixed and the copy is
 * polished here** (T-006 spec): the pane leads with the reader's access — every piece
 * included, some, or none — lists exactly the evidence the reader may open and nothing
 * about the rest, names the Admin whose recorded override created the state when an
 * override outruns the evidence, and never dead-ends: `next` always says where the reader
 * goes from here.
 */
export type EvidencePane = {
  /** What this reader's access reaches of the concept's cited evidence — the lead. */
  readonly access: "included" | "partly-included" | "not-included";
  /** The sentence the pane opens with, in the reader's words. */
  readonly lead: string;
  /** The cited evidence this reader may open, and only that. */
  readonly evidence: readonly ReadableEvidence[];
  /**
   * The *shared beyond its evidence* state: the Admin whose recorded override lets this
   * reader see a concept whose cited evidence they may not, and when. Never a rider and
   * never a trust signal; absent when no override outruns the evidence.
   */
  readonly sharedBeyondEvidence: { readonly by: ActorId; readonly at: Date } | undefined;
  /** Where the reader goes next, so the pane is never a dead end. */
  readonly next: string;
};

/** The pane's copy, one sentence per routing, so the words live beside the rule. */
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

/**
 * The pane for one concept, or nothing — for a concept this reader may not see and for one
 * nobody minted alike, through the same predicate `open` reads by, so the pane is never a
 * side door to a withheld concept.
 *
 * Each piece of cited evidence reaches the reader through **the predicate on the binding
 * its document was yielded by** — the same three columns, the same renderer — and a
 * citation whose document the catalogue does not hold reaches nobody, which is the
 * fail-closed answer. What is withheld is neither counted nor listed: the pane says only
 * whether all, some or none of what the concept cites is included, and that sentence is
 * the glossary's own.
 */
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

/** The routing: three states off two counts, the override named where it outruns the evidence. */
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
