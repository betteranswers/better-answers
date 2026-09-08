import {
  derivedVisibility,
  readableClause,
  readableParameters,
  RESTRICTED_TO_ADMINS,
  visibilityOf,
  type VisibilityRow,
} from "../access/index.ts";
import {
  attempt,
  err,
  ok,
  type Principal,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import { scopeClause, scopeParameter, type Tx } from "../store/postgres/index.ts";

/**
 * Slice: **guides** — guides, compositions, includes, sections, footnotes, the renderer,
 * the review flow (ADRs 0004, 0014, 0015).
 *
 * What lands here is what the visibility cascade and the footnote read need (T-055; ADR
 * 0023, ADR 0039): a composition's class is the most restrictive among its includes and its
 * audience their intersection, recomputed in the same transaction as the narrowing that
 * moved one of them — the second of the cascade's two levels — and a composition's
 * footnotes reach a reader through the composition's own predicate **and** each included
 * concept's, so a citation is never a side door to a concept its reader may not see. The
 * composition as a product — prose, versions, the renderer — is B8's.
 */

/** One footnote as ADR 0015 renders it: labelled by the include, naming the concept it cites. */
export type Footnote = {
  /** The include's id — the label the citation marker in the prose carries (`[^i7]`). */
  readonly label: string;
  readonly iri: string;
  readonly title: string;
};

/** A composition's own three columns, read as the fallback its recompute keeps, and its keys. */
type CompositionRow = VisibilityRow & { readonly workspace_id: string; readonly id: string };

/** One include as the recompute reads it: the concept's pair, or nothing where the concept has no row. */
type IncludeRow = {
  readonly sensitivity: string | null;
  readonly audience: string | null;
  readonly audience_groups: readonly string[] | null;
};

/**
 * The cascade's second level, in the caller's transaction: every composition including one
 * of the concepts named is re-derived from what its includes hold **now** — the most
 * restrictive class, the audiences' intersection, an empty intersection forcing Restricted
 * (ADR 0039) — and rewritten. A composition has no kind, so no floor applies.
 *
 * **An include whose concept has no index row counts as Restricted**, never as absent. An
 * include names an identity, and an identity can stand without its row — a creation whose
 * rows were lost in the crash window and not yet replayed — so dropping it from the
 * derivation would widen the composition to whatever its other includes allow, over a
 * concept nobody can yet say the class of. The most restrictive visibility there is stands
 * in until the row does; a composition whose includes' rows are all gone therefore lands
 * Restricted too, which is the same fail-closed answer.
 *
 * **Each composition's row is taken `FOR UPDATE` before its includes are read**, so two
 * cascades reaching one composition — a narrowing and a governed write landing beside it —
 * recompute it one after the other, the second reading what the first committed: under
 * READ COMMITTED each would otherwise derive from the other's includes as they stood before
 * either moved, and the last to write would store one include's groups where the two
 * together intersect to nobody.
 *
 * Takes the transaction rather than a door, so its failure aborts the act it runs inside
 * (the kernel's result convention, rule 5): a recompute that could half-land would leave the
 * guide-footnote leak ADR 0023's two-level rule exists to close. The Principal is either
 * kind — a person's narrowing or write, or the platform's replay — and names the workspace
 * the statements reach, through the Postgres door's one idiom for both kinds.
 *
 * Answers the ids of the compositions it rewrote, so the act can say what it moved.
 */
export const recomputeCompositionsIncluding = async (
  principal: Principal,
  tx: Tx,
  input: { readonly iris: readonly string[] },
): Promise<readonly string[]> => {
  if (input.iris.length === 0) return [];
  const including = await tx.query<CompositionRow>(
    `SELECT p.workspace_id, p.id, p.sensitivity, p.audience, p.audience_groups
       FROM composition p
      WHERE p.workspace_id = ${scopeClause(1)}
        AND p.id IN (SELECT i.composition_id FROM composition_include i
                      WHERE i.workspace_id = p.workspace_id AND i.iri = ANY($2::text[]))
      ORDER BY p.id
      FOR UPDATE`,
    [scopeParameter(principal), [...new Set(input.iris)]],
  );
  const moved: string[] = [];
  for (const composition of including.rows) {
    const includes = await tx.query<IncludeRow>(
      `SELECT c.sensitivity, c.audience, c.audience_groups
         FROM composition_include i
         LEFT JOIN concept_index c ON c.workspace_id = i.workspace_id AND c.iri = i.iri
        WHERE i.workspace_id = $1 AND i.composition_id = $2`,
      [composition.workspace_id, composition.id],
    );
    const derived = derivedVisibility({
      from: includes.rows.map((include) =>
        include.sensitivity === null || include.audience === null
          ? RESTRICTED_TO_ADMINS
          : visibilityOf({
              sensitivity: include.sensitivity,
              audience: include.audience,
              audience_groups: include.audience_groups,
            }),
      ),
      fallback: visibilityOf(composition),
    });
    await tx.query(
      `UPDATE composition SET sensitivity = $3, audience = $4, audience_groups = $5
        WHERE workspace_id = $1 AND id = $2`,
      [
        composition.workspace_id,
        composition.id,
        derived.sensitivity,
        derived.audience,
        derived.audienceGroups,
      ],
    );
    moved.push(composition.id);
  }
  return moved;
};

/**
 * A composition's footnotes as this reader may see them, in the includes' order, or
 * nothing at all — for a composition this reader may not see and for one nobody made
 * alike, which is the requirement: probing ids reveals nothing.
 *
 * Two predicates, both in the statements' WHERE clauses. The composition's own three
 * columns decide whether the reader reaches the page at all — the cascade keeps them the
 * most restrictive of its includes, so a Restricted-sourced include withholds the whole
 * composition — and each include's concept row decides whether its footnote appears, so a
 * composition whose columns are behind its includes' still cites nothing its reader may
 * not open. A withheld footnote is not counted and not hinted at: the list is simply the
 * footnotes the reader may see (ADR 0016).
 */
export const footnotesOf = async (
  principal: UserPrincipal,
  tx: Tx,
  compositionId: string,
): Promise<Result<readonly Footnote[] | undefined, Error>> => {
  const parameters = readableParameters(principal);
  const page = await attempt(() =>
    tx.query(
      `SELECT 1 FROM composition p
        WHERE p.workspace_id = $1 AND p.id = $2 AND ${readableClause("p", 3)}`,
      [principal.workspaceId, compositionId, ...parameters],
    ),
  );
  if (!page.ok) return err(page.error);
  if (page.value.rowCount === 0) return ok(undefined);

  const footnotes = await attempt(() =>
    tx.query<Footnote>(
      `SELECT i.id AS label, i.iri, c.title
         FROM composition_include i
         JOIN concept_index c ON c.workspace_id = i.workspace_id AND c.iri = i.iri
        WHERE i.workspace_id = $1 AND i.composition_id = $2 AND ${readableClause("c", 3)}
        ORDER BY i.ordinal, i.id`,
      [principal.workspaceId, compositionId, ...parameters],
    ),
  );
  if (!footnotes.ok) return err(footnotes.error);
  return ok(footnotes.value.rows);
};
