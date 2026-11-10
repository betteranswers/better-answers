type Section = { readonly guide: string; readonly section: string };

/** True for an Admin, and for anyone else only where no section from this one up is hidden. `$1` is the workspace. */
export const shownClause = ({ guide, section }: Section, roleParameter: number): string => `
  ($${String(roleParameter)} = 'Admin' OR NOT EXISTS (
     WITH RECURSIVE withheld (guide_id, id) AS (
       SELECT guide_id, id FROM guide_section WHERE workspace_id = $1 AND hidden
       UNION
       SELECT below.guide_id, below.id
         FROM guide_section below
         JOIN withheld above ON above.guide_id = below.guide_id AND above.id = below.parent_id
        WHERE below.workspace_id = $1
     )
     SELECT 1 FROM withheld WHERE withheld.guide_id = ${guide} AND withheld.id = ${section}))`;
