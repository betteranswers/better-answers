import {
  derivedVisibility,
  readableClause,
  readableParameters,
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
import type { Tx } from "../store/postgres/index.ts";

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

/** A composition's own three columns, read as the fallback its recompute keeps. */
type CompositionRow = VisibilityRow & { readonly id: string };

/**
 * The cascade's second level, in the caller's transaction: every composition including one
 * of the concepts named is re-derived from what its includes hold **now** — the most
 * restrictive class, the audiences' intersection, an empty intersection forcing Restricted
 * (ADR 0039) — and rewritten. A composition has no kind, so no floor applies; one whose
 * includes' rows are all gone keeps what it holds, which is the fail-closed answer.
 *
 * Takes the transaction rather than a door, so its failure aborts the act it runs inside
 * (the kernel's result convention, rule 5): a recompute that could half-land would leave the
 * guide-footnote leak ADR 0023's two-level rule exists to close. The Principal is either
 * kind — a person's narrowing, or the platform's replay — and the workspace is the caller's,
 * as the rows it recomputes carry it.
 *
 * Answers the ids of the compositions it rewrote, so the act can say what it moved.
 */
export const recomputeCompositionsIncluding = async (
  _principal: Principal,
  tx: Tx,
  input: { readonly workspaceId: string; readonly iris: readonly string[] },
): Promise<readonly string[]> => {
  if (input.iris.length === 0) return [];
  const including = await tx.query<CompositionRow>(
    `SELECT DISTINCT p.id, p.sensitivity, p.audience, p.audience_groups
       FROM composition p
       JOIN composition_include i ON i.workspace_id = p.workspace_id AND i.composition_id = p.id
      WHERE p.workspace_id = $1 AND i.iri = ANY($2::text[])
      ORDER BY p.id`,
    [input.workspaceId, [...new Set(input.iris)]],
  );
  const moved: string[] = [];
  for (const composition of including.rows) {
    const includes = await tx.query<VisibilityRow>(
      `SELECT c.sensitivity, c.audience, c.audience_groups
         FROM composition_include i
         JOIN concept_index c ON c.workspace_id = i.workspace_id AND c.iri = i.iri
        WHERE i.workspace_id = $1 AND i.composition_id = $2`,
      [input.workspaceId, composition.id],
    );
    const derived = derivedVisibility({
      from: includes.rows.map(visibilityOf),
      fallback: visibilityOf(composition),
    });
    await tx.query(
      `UPDATE composition SET sensitivity = $3, audience = $4, audience_groups = $5
        WHERE workspace_id = $1 AND id = $2`,
      [
        input.workspaceId,
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
