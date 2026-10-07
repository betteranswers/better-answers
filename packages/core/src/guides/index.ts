import {
  derivedVisibility,
  readableClause,
  readableParameters,
  RESTRICTED_TO_ADMINS,
  visibilityOf,
  type Visibility,
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

export type Footnote = {
  readonly label: string;
  readonly iri: string;
  readonly title: string;
};

type WriteUpRow = VisibilityRow & { readonly workspace_id: string; readonly id: string };

type IncludeRow = {
  readonly sensitivity: string | null;
  readonly audience: string | null;
  readonly audience_groups: readonly string[] | null;
};

const visibilityOfInclude = (include: IncludeRow): Visibility =>
  include.sensitivity === null || include.audience === null
    ? RESTRICTED_TO_ADMINS
    : visibilityOf({
        sensitivity: include.sensitivity,
        audience: include.audience,
        audience_groups: include.audience_groups,
      });

/**
 * Locks and re-derives each write-up including one of `iris`; an include whose concept is gone
 * counts as admins-only. Answers the id of each one recomputed, changed or not, in id order.
 */
export const recomputeWriteUpsIncluding = async (
  principal: Principal,
  tx: Tx,
  input: { readonly iris: readonly string[] },
): Promise<readonly string[]> => {
  if (input.iris.length === 0) return [];
  const including = await tx.query<WriteUpRow>(
    `SELECT p.workspace_id, p.id, p.sensitivity, p.audience, p.audience_groups
       FROM write_up p
      WHERE p.workspace_id = ${scopeClause(1)}
        AND p.id IN (SELECT i.write_up_id FROM write_up_include i
                      WHERE i.workspace_id = p.workspace_id AND i.iri = ANY($2::text[]))
      ORDER BY p.id
      FOR UPDATE`,
    [scopeParameter(principal), [...new Set(input.iris)]],
  );
  const moved: string[] = [];
  for (const writeUp of including.rows) {
    const includes = await tx.query<IncludeRow>(
      `SELECT c.sensitivity, c.audience, c.audience_groups
         FROM write_up_include i
         LEFT JOIN concept_index c ON c.workspace_id = i.workspace_id AND c.iri = i.iri
        WHERE i.workspace_id = $1 AND i.write_up_id = $2`,
      [writeUp.workspace_id, writeUp.id],
    );
    const derived = derivedVisibility({
      from: includes.rows.map(visibilityOfInclude),
      fallback: visibilityOf(writeUp),
    });
    await tx.query(
      `UPDATE write_up SET sensitivity = $3, audience = $4, audience_groups = $5
        WHERE workspace_id = $1 AND id = $2`,
      [
        writeUp.workspace_id,
        writeUp.id,
        derived.sensitivity,
        derived.audience,
        derived.audienceGroups,
      ],
    );
    moved.push(writeUp.id);
  }
  return moved;
};

/**
 * Undefined when the write-up is absent or the principal cannot read it. Otherwise only the
 * includes whose concept the principal reads, in the write-up's order.
 */
export const footnotesOf = async (
  principal: UserPrincipal,
  tx: Tx,
  writeUpId: string,
): Promise<Result<readonly Footnote[] | undefined, Error>> => {
  const parameters = readableParameters(principal);
  const page = await attempt(() =>
    tx.query(
      `SELECT 1 FROM write_up p
        WHERE p.workspace_id = $1 AND p.id = $2 AND ${readableClause("p", 3)}`,
      [principal.workspaceId, writeUpId, ...parameters],
    ),
  );
  if (!page.ok) return err(page.error);
  if (page.value.rowCount === 0) return ok(undefined);

  const footnotes = await attempt(() =>
    tx.query<Footnote>(
      `SELECT i.id AS label, i.iri, c.title
         FROM write_up_include i
         JOIN concept_index c ON c.workspace_id = i.workspace_id AND c.iri = i.iri
        WHERE i.workspace_id = $1 AND i.write_up_id = $2 AND ${readableClause("c", 3)}
        ORDER BY i.ordinal, i.id`,
      [principal.workspaceId, writeUpId, ...parameters],
    ),
  );
  if (!footnotes.ok) return err(footnotes.error);
  return ok(footnotes.value.rows);
};
