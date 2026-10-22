import { readableClause } from "../access/index.ts";

type MatchAt = {
  readonly scope: number;
  readonly reader: number;
  readonly guideCollection: string;
};

export const matchesTheFact = (at: MatchAt): string =>
  `c.workspace_id = $${at.scope}
     AND ${readableClause("c", at.reader)}
     AND c.kind = f.kind
     AND COALESCE(c.frontmatter -> 'tags', '[]'::jsonb) @> to_jsonb(f.tags)
     AND c.collection = COALESCE(f.collection, ${at.guideCollection})`;

export type FirstMatch = {
  readonly section_id: string;
  readonly fact_id: string;
  readonly iri: string;
  readonly content_hash: string;
};

export const firstMatchesSql = (
  at: MatchAt & { readonly facts: string; readonly besides?: number },
): string => {
  const besides =
    at.besides === undefined
      ? ""
      : `AND NOT EXISTS (SELECT 1 FROM write_up_include i
                          WHERE i.workspace_id = c.workspace_id
                            AND i.write_up_id = $${at.besides} AND i.iri = c.iri)`;
  return `SELECT m.section_id, m.fact_id, m.iri, m.content_hash
            FROM (SELECT DISTINCT ON (f.section_id, c.iri)
                         f.section_id, f.id AS fact_id, f.ordinal, c.iri, c.title, c.content_hash
                    FROM ${at.facts}
                    JOIN concept_index c ON ${matchesTheFact(at)} ${besides}
                   ORDER BY f.section_id, c.iri, f.ordinal) m
           ORDER BY m.section_id, m.ordinal, m.title, m.iri`;
};
