import { z } from "zod";

import { readableClause, readableParameters } from "../../access/index.ts";
import {
  admit,
  ANY_ROLE,
  attempt,
  declareAction,
  err,
  ok,
  type RefusalOf,
  type Result,
  type UserPrincipal,
} from "../../kernel/index.ts";
import type { Tx } from "../../store/postgres/index.ts";
import { shownClause } from "../withheld.ts";
import { SECTION_HOME } from "../write-ups.ts";

type GuideSummary = {
  readonly guideId: string;
  readonly guideType: string;
  readonly collection: string;
  readonly subject: { readonly iri: string; readonly title: string } | null;
  readonly sections: number;
  readonly needsReview: number;
};

const readGuidesAction = declareAction({
  admits: ANY_ROLE,
  input: z.object({}),
  refuses: ["role-forbids"],
});

type SummaryRow = {
  readonly id: string;
  readonly guide_type: string;
  readonly collection: string;
  readonly subject_iri: string | null;
  readonly subject_title: string | null;
  readonly sections: number;
  readonly needs_review: number;
};

const GUIDES = `
  SELECT g.id, g.guide_type, g.collection, g.subject_iri, c.title AS subject_title,
         count(s.id)::int AS sections,
         count(*) FILTER (WHERE ${readableClause("w", 2)} AND w.needs_review IS NOT NULL)::int
           AS needs_review
    FROM guide_definition g
    LEFT JOIN concept_index c ON c.workspace_id = g.workspace_id AND c.iri = g.subject_iri
                             AND ${readableClause("c", 2)}
    LEFT JOIN guide_section s ON s.workspace_id = g.workspace_id AND s.guide_id = g.id
                             AND ${shownClause({ guide: "s.guide_id", section: "s.id" }, 2)}
    LEFT JOIN write_up w ON w.workspace_id = s.workspace_id AND w.home = '${SECTION_HOME}'
                        AND w.guide_id = s.guide_id AND w.section_id = s.id
   WHERE g.workspace_id = $1
   GROUP BY g.workspace_id, g.id, c.title
   ORDER BY g.created_at, g.id`;

export const readGuides = async (
  principal: UserPrincipal,
  tx: Tx,
): Promise<Result<readonly GuideSummary[], RefusalOf<typeof readGuidesAction> | Error>> => {
  const admitted = admit(readGuidesAction, principal, {});
  if (!admitted.ok) return err(admitted.error);
  const reader = admitted.value;
  const read = await attempt(() =>
    tx.query<SummaryRow>(GUIDES, [reader.workspaceId, ...readableParameters(reader)]),
  );
  if (!read.ok) return err(read.error);
  return ok(
    read.value.rows.map((row) => ({
      guideId: row.id,
      guideType: row.guide_type,
      collection: row.collection,
      subject:
        row.subject_iri === null || row.subject_title === null
          ? null
          : { iri: row.subject_iri, title: row.subject_title },
      sections: row.sections,
      needsReview: row.needs_review,
    })),
  );
};
