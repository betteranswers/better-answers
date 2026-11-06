import { readableClause, readableParameters } from "../access/index.ts";
import type { UserPrincipal } from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import { SECTION_HOME } from "./write-ups.ts";

export const WITHHELD_SECTIONS = `
  WITH RECURSIVE withheld (guide_id, id) AS (
    SELECT guide_id, id FROM guide_section WHERE workspace_id = $1 AND hidden
    UNION
    SELECT s.guide_id, s.id
      FROM guide_section s
      JOIN withheld h ON h.guide_id = s.guide_id AND h.id = s.parent_id
     WHERE s.workspace_id = $1
  )`;

const GUIDES_CITING = `${WITHHELD_SECTIONS}
  SELECT count(DISTINCT w.guide_id)::int AS guides
    FROM write_up_include i
    JOIN write_up w ON w.workspace_id = i.workspace_id AND w.id = i.write_up_id
   WHERE i.workspace_id = $1 AND i.iri = $2 AND w.home = '${SECTION_HOME}'
     AND ${readableClause("w", 3)}
     AND ($3 = 'Admin' OR NOT EXISTS (
           SELECT 1 FROM withheld h WHERE h.guide_id = w.guide_id AND h.id = w.section_id))`;

/** How many guides cite the concept in a section the reader can read. */
export const guidesCiting = async (reader: UserPrincipal, tx: Tx, iri: string): Promise<number> => {
  const counted = await tx.query<{ guides: number }>(GUIDES_CITING, [
    reader.workspaceId,
    iri,
    ...readableParameters(reader),
  ]);
  return counted.rows[0]?.guides ?? 0;
};
