import { z } from "zod";

import { readableClause, readableParameters } from "../access/index.ts";
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
} from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import { matchesTheFact } from "./match.ts";
import { SECTION_HOME } from "./write-ups.ts";

export type Footnote = {
  readonly label: string;
  readonly iri: string;
  readonly title: string;
};

const footnotesOfAction = declareAction({
  admits: ANY_ROLE,
  input: z.custom<string>(),
  refuses: ["role-forbids"],
});

export const footnotesOf = async (
  principal: UserPrincipal,
  tx: Tx,
  writeUpId: string,
): Promise<
  Result<readonly Footnote[] | undefined, RefusalOf<typeof footnotesOfAction> | Error>
> => {
  const admitted = admit(footnotesOfAction, principal, writeUpId);
  if (!admitted.ok) return err(admitted.error);
  const reader = admitted.value;

  const parameters = readableParameters(reader);
  const page = await attempt(() =>
    tx.query(
      `SELECT 1 FROM write_up p
        WHERE p.workspace_id = $1 AND p.id = $2 AND ${readableClause("p", 3)}`,
      [reader.workspaceId, writeUpId, ...parameters],
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
      [reader.workspaceId, writeUpId, ...parameters],
    ),
  );
  if (!footnotes.ok) return err(footnotes.error);
  return ok(footnotes.value.rows);
};

type FactCoverage = {
  readonly factId: string;
  readonly name: string;
  readonly state: "met" | "available" | "missing";

  readonly available: readonly { readonly iri: string; readonly title: string }[];
};

type SectionCoverage = {
  readonly sectionId: string;
  readonly writeUpId: string;
  readonly prompt: string;
  readonly facts: readonly FactCoverage[];
};

export type Coverage = {
  readonly guideId: string;
  readonly collection: string;

  readonly sections: readonly SectionCoverage[];
};

const coverageOfAction = declareAction({
  admits: ANY_ROLE,
  input: z.custom<string>(),
  refuses: ["role-forbids"],
});

export type CoverageRow = {
  readonly collection: string;
  readonly section_id: string;
  readonly parent_id: string | null;
  readonly prompt: string;
  readonly write_up_id: string;
  readonly fact_id: string | null;
  readonly name: string | null;
  readonly at_least: number | null;
  readonly met_by: number;
  readonly available: FactCoverage["available"];
};

const COVERAGE = `
  SELECT g.collection, s.id AS section_id, s.parent_id, s.prompt, w.id AS write_up_id,
         f.id AS fact_id, f.name, f.at_least,
         (SELECT count(*)::int
            FROM write_up_include i
            JOIN concept_index c ON c.workspace_id = i.workspace_id AND c.iri = i.iri
           WHERE i.workspace_id = w.workspace_id AND i.write_up_id = w.id
             AND i.expected_fact_id = f.id
             AND ${readableClause("c", 3)}) AS met_by,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('iri', c.iri, 'title', c.title)
                                    ORDER BY c.title, c.iri)
                     FROM concept_index c
                    WHERE ${matchesTheFact({ scope: 1, reader: 3, guideCollection: "g.collection" })}
                      AND NOT EXISTS (SELECT 1 FROM write_up_include i
                                       WHERE i.workspace_id = w.workspace_id
                                         AND i.write_up_id = w.id AND i.iri = c.iri)),
                  '[]'::jsonb) AS available
    FROM guide_definition g
    JOIN guide_section s ON s.workspace_id = g.workspace_id AND s.guide_id = g.id
    JOIN write_up w ON w.workspace_id = s.workspace_id AND w.home = '${SECTION_HOME}'
                   AND w.guide_id = s.guide_id AND w.section_id = s.id
    LEFT JOIN guide_expected_fact f ON f.workspace_id = s.workspace_id
                                   AND f.guide_id = s.guide_id AND f.section_id = s.id
   WHERE g.workspace_id = $1 AND g.id = $2
   ORDER BY s.ordinal, f.ordinal`;

const stateOf = (row: CoverageRow & { readonly at_least: number }): FactCoverage["state"] => {
  if (row.met_by >= row.at_least) return "met";
  return row.available.length > 0 ? "available" : "missing";
};

const factOf = (row: CoverageRow): FactCoverage[] =>
  row.fact_id === null || row.name === null || row.at_least === null
    ? []
    : [
        {
          factId: row.fact_id,
          name: row.name,
          state: stateOf({ ...row, at_least: row.at_least }),
          available: row.met_by >= row.at_least ? [] : row.available,
        },
      ];

const inTreeOrder = (rows: readonly CoverageRow[], parentId: string | null): SectionCoverage[] => {
  const sectionIds = [
    ...new Set(rows.filter((row) => row.parent_id === parentId).map((row) => row.section_id)),
  ];
  return sectionIds.flatMap((sectionId) => {
    const own = rows.filter((row) => row.section_id === sectionId);
    const [first] = own;
    if (first === undefined) return [];
    return [
      {
        sectionId,
        writeUpId: first.write_up_id,
        prompt: first.prompt,
        facts: own.flatMap(factOf),
      },
      ...inTreeOrder(rows, sectionId),
    ];
  });
};

export const coverageFrom = (
  guideId: string,
  rows: readonly CoverageRow[],
): Coverage | undefined => {
  const [first] = rows;
  if (first === undefined) return undefined;
  return { guideId, collection: first.collection, sections: inTreeOrder(rows, null) };
};

export const coverageOf = async (
  principal: UserPrincipal,
  tx: Tx,
  guideId: string,
): Promise<Result<Coverage | undefined, RefusalOf<typeof coverageOfAction> | Error>> => {
  const admitted = admit(coverageOfAction, principal, guideId);
  if (!admitted.ok) return err(admitted.error);
  const reader = admitted.value;

  const read = await attempt(() =>
    tx.query<CoverageRow>(COVERAGE, [reader.workspaceId, guideId, ...readableParameters(reader)]),
  );
  if (!read.ok) return err(read.error);
  return ok(coverageFrom(guideId, read.value.rows));
};
