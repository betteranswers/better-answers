import { readableClause, readableParameters } from "../access/index.ts";
import type { UserPrincipal } from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import { shownClause } from "./withheld.ts";
import { SECTION_HOME } from "./write-ups.ts";

const GUIDES_CITING = `
  SELECT count(DISTINCT w.guide_id)::int AS guides
    FROM write_up_include i
    JOIN write_up w ON w.workspace_id = i.workspace_id AND w.id = i.write_up_id
   WHERE i.workspace_id = $1 AND i.iri = $2 AND w.home = '${SECTION_HOME}'
     AND ${readableClause("w", 3)}
     AND ${shownClause({ guide: "w.guide_id", section: "w.section_id" }, 3)}`;

/** How many guides cite the concept in a section the reader can read. */
export const guidesCiting = async (reader: UserPrincipal, tx: Tx, iri: string): Promise<number> => {
  const counted = await tx.query<{ guides: number }>(GUIDES_CITING, [
    reader.workspaceId,
    iri,
    ...readableParameters(reader),
  ]);
  return counted.rows[0]?.guides ?? 0;
};
