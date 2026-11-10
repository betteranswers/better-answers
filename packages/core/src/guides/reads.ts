import { z } from "zod";

import { boundarySchemas, type NEEDS_REVIEW_REASONS } from "@better-answers/schema";

import { readableClause, readableParameters } from "../access/index.ts";
import type { Frontmatter } from "../concepts/index.ts";
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
import {
  withEvidence,
  type DetailEvidence,
  type Evidenced,
  type EvidenceOf,
} from "./read/evidence.ts";
import { renderBrief, type Footnote, type RenderedBrief } from "./renderer.ts";
import type { GuideLayer, RoleLabel } from "./templates/index.ts";
import { SECTION_HOME } from "./write-ups.ts";

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

type FactRead = Coverage["sections"][number]["facts"][number] & {
  readonly conceptType: string;
  readonly tags: readonly string[];
};

type SectionFacts = {
  readonly met: number;
  readonly of: number;
  readonly facts: readonly FactRead[];
};

type Detail = {
  readonly iri: string;
  readonly title: string;
  readonly conceptType: string;
  readonly body: string;
  readonly evidence: DetailEvidence;
};

type BriefRead = {
  readonly version: number;
  readonly rendered: RenderedBrief;
  readonly detail: readonly Detail[];

  /** Present for an Editor or an Admin, who may change the Brief. */
  readonly editable?: { readonly markdown: string; readonly footnotes: readonly Footnote[] };
};

type NeedsReview = (typeof NEEDS_REVIEW_REASONS)[number];

export type SectionRead = {
  readonly sectionId: string;
  readonly writeUpId: string;
  readonly number: string;
  readonly prompt: string;
  readonly roleLabel: RoleLabel;
  readonly usageNote: string | null;
  readonly layers: readonly GuideLayer[];
  readonly hidden: boolean;
  readonly needsReview: NeedsReview | null;
  readonly coverage: SectionFacts;

  /** Absent when the reader may not read the write-up. */
  readonly brief: BriefRead | undefined;

  /** The concepts the reader may read that the section cites, whether or not it shows them. */
  readonly citedIris: readonly string[];
};

export type GuideRead = {
  readonly guideId: string;
  readonly guideType: string;
  readonly collection: string;
  readonly subject: { readonly iri: string; readonly title: string } | null;
  readonly coverage: { readonly met: number; readonly of: number };
  readonly sections: readonly SectionRead[];
};

export const readGuideInput = z.strictObject({
  guideId: boundarySchemas.guideDefinition.select.shape.id,
});

type ReadGuideInput = z.input<typeof readGuideInput>;

export type GuideReadRefusal = RefusalOf<typeof readGuideAction> | Error;

const readGuideAction = declareAction({
  admits: ANY_ROLE,
  input: z.custom<ReadGuideInput>(),
  refuses: ["role-forbids"],
});

type DefinitionRow = {
  readonly guide_type: string;
  readonly collection: string;
  readonly subject_iri: string | null;
  readonly subject_title: string | null;
};

const DEFINITION = `
  SELECT g.guide_type, g.collection, g.subject_iri, c.title AS subject_title
    FROM guide_definition g
    LEFT JOIN concept_index c ON c.workspace_id = g.workspace_id AND c.iri = g.subject_iri
                             AND ${readableClause("c", 3)}
   WHERE g.workspace_id = $1 AND g.id = $2`;

type SectionRow = {
  readonly section_id: string;
  readonly parent_id: string | null;
  readonly prompt: string;
  readonly role_label: RoleLabel;
  readonly usage_note: string | null;
  readonly layers: readonly GuideLayer[];
  readonly hidden: boolean;
  readonly write_up_id: string;
  readonly readable: boolean;
  readonly needs_review: NeedsReview | null;
  readonly version: number | null;
  readonly markdown: string | null;
};

const WRITE_UP_READABLE = `(${readableClause("w", 3)})`;

const SECTIONS = `
  SELECT s.id AS section_id, s.parent_id, s.prompt, s.role_label, s.usage_note, s.layers, s.hidden,
         w.id AS write_up_id, ${WRITE_UP_READABLE} AS readable,
         CASE WHEN ${WRITE_UP_READABLE} THEN w.needs_review END AS needs_review,
         CASE WHEN ${WRITE_UP_READABLE} THEN v.version END AS version,
         CASE WHEN ${WRITE_UP_READABLE} THEN v.markdown END AS markdown
    FROM guide_section s
    JOIN write_up w ON w.workspace_id = s.workspace_id AND w.home = '${SECTION_HOME}'
                   AND w.guide_id = s.guide_id AND w.section_id = s.id
    LEFT JOIN LATERAL (SELECT version, markdown FROM write_up_version
                        WHERE workspace_id = w.workspace_id AND write_up_id = w.id
                        ORDER BY version DESC LIMIT 1) v ON true
   WHERE s.workspace_id = $1 AND s.guide_id = $2`;

type CitedRow = Footnote & {
  readonly write_up_id: string;
  readonly concept_type: string;
  readonly body: string;
  readonly frontmatter: Frontmatter;
};

type CitedRead = Evidenced<CitedRow>;

const CITED = `
  SELECT i.write_up_id, i.id AS label, i.iri, c.title, c.concept_type, c.body, c.frontmatter
    FROM write_up_include i
    JOIN write_up w ON w.workspace_id = i.workspace_id AND w.id = i.write_up_id
    JOIN concept_index c ON c.workspace_id = i.workspace_id AND c.iri = i.iri
   WHERE w.workspace_id = $1 AND w.guide_id = $2 AND w.home = '${SECTION_HOME}'
     AND ${readableClause("c", 3)}
   ORDER BY i.write_up_id, i.ordinal, i.id`;

type FactShapeRow = {
  readonly id: string;
  readonly concept_type: string;
  readonly tags: readonly string[];
};

const FACT_SHAPES = `SELECT id, concept_type, tags FROM guide_expected_fact
   WHERE workspace_id = $1 AND guide_id = $2`;

const hiddenFrom = (reader: UserPrincipal, rows: readonly SectionRow[]): ReadonlySet<string> => {
  const hidden = new Set<string>();
  if (reader.role === "Admin") return hidden;
  for (const row of rows) {
    if (row.hidden || (row.parent_id !== null && hidden.has(row.parent_id))) {
      hidden.add(row.section_id);
    }
  }
  return hidden;
};

const numberedIn = (rows: readonly SectionRow[]): ReadonlyMap<string, string> => {
  const placed = new Map<string | null, number>();
  const numbers = new Map<string, string>();
  for (const row of rows) {
    const place = (placed.get(row.parent_id) ?? 0) + 1;
    placed.set(row.parent_id, place);
    const parent = row.parent_id === null ? undefined : numbers.get(row.parent_id);
    numbers.set(
      row.section_id,
      parent === undefined ? String(place) : `${parent}.${String(place)}`,
    );
  }
  return numbers;
};

type Briefed = SectionRow & { readonly version: number; readonly markdown: string };

const showsBrief = (row: SectionRow): row is Briefed =>
  row.readable && row.version !== null && row.markdown !== null;

const briefOf = (
  reader: UserPrincipal,
  row: SectionRow,
  cited: readonly CitedRead[],
): BriefRead | undefined => {
  if (!showsBrief(row)) return undefined;
  const footnotes = cited.map(({ label, iri, title }) => ({ label, iri, title }));
  const read = {
    version: row.version,
    rendered: renderBrief(row.markdown, footnotes, "page"),
    detail: cited.map(({ iri, title, concept_type: conceptType, body, evidence }) => ({
      iri,
      title,
      conceptType,
      body,
      evidence,
    })),
  };
  return reader.role === "Viewer"
    ? read
    : { ...read, editable: { markdown: row.markdown, footnotes } };
};

const metIn = (facts: readonly { readonly state: string }[]): number =>
  facts.filter((fact) => fact.state === "met").length;

type GuideHeld = {
  readonly definition: DefinitionRow;
  readonly coverage: Coverage;
  readonly sections: readonly SectionRow[];
  readonly shapes: readonly FactShapeRow[];
};

type Shown = readonly {
  readonly section: Coverage["sections"][number];
  readonly row: SectionRow;
}[];

const shownTo = (reader: UserPrincipal, held: GuideHeld): Shown => {
  const rowOf = new Map(held.sections.map((row) => [row.section_id, row]));
  const ordered = held.coverage.sections.flatMap((section) => {
    const row = rowOf.get(section.sectionId);
    return row === undefined ? [] : [{ section, row }];
  });
  const hidden = hiddenFrom(
    reader,
    ordered.map(({ row }) => row),
  );
  return ordered.filter(({ row }) => !hidden.has(row.section_id));
};

const guideFrom = (
  reader: UserPrincipal,
  guideId: string,
  held: GuideHeld,
  shown: Shown,
  cited: readonly CitedRead[],
): GuideRead => {
  const { definition, coverage } = held;
  const numbers = numberedIn(shown.map(({ row }) => row));
  const shapeOf = new Map(held.shapes.map((shape) => [shape.id, shape]));
  const citedBy = Map.groupBy(cited, (row) => row.write_up_id);
  const everyFact = coverage.sections.flatMap((section) => section.facts);
  return {
    guideId,
    guideType: definition.guide_type,
    collection: definition.collection,
    subject:
      definition.subject_iri === null || definition.subject_title === null
        ? null
        : { iri: definition.subject_iri, title: definition.subject_title },
    coverage: { met: metIn(everyFact), of: everyFact.length },
    sections: shown.map(({ section, row }) => {
      const citing = citedBy.get(row.write_up_id) ?? [];
      return {
        sectionId: row.section_id,
        writeUpId: row.write_up_id,
        number: numbers.get(row.section_id) ?? "",
        prompt: row.prompt,
        roleLabel: row.role_label,
        usageNote: row.usage_note,
        layers: row.layers,
        hidden: row.hidden,
        needsReview: row.needs_review,
        coverage: {
          met: metIn(section.facts),
          of: section.facts.length,
          facts: section.facts.map((fact) => {
            const shape = shapeOf.get(fact.factId);
            if (shape === undefined)
              throw new Error(`guides: no concept type and tags were read for fact ${fact.factId}`);
            return { ...fact, conceptType: shape.concept_type, tags: shape.tags };
          }),
        },
        brief: briefOf(reader, row, citing),
        citedIris: citing.map((each) => each.iri),
      };
    }),
  };
};

export const readGuide = async (
  principal: UserPrincipal,
  tx: Tx,
  input: ReadGuideInput,
  evidenceOf: EvidenceOf,
): Promise<Result<GuideRead | undefined, GuideReadRefusal>> => {
  const admitted = admit(readGuideAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const reader = admitted.value;
  const { guideId } = input;

  const read = await attempt(async () => {
    const scoped = [reader.workspaceId, guideId];
    const withReader = [...scoped, ...readableParameters(reader)];
    const definition = (await tx.query<DefinitionRow>(DEFINITION, withReader)).rows[0];
    if (definition === undefined) return undefined;
    const sections = await tx.query<SectionRow>(SECTIONS, withReader);
    const cited = await tx.query<CitedRow>(CITED, withReader);
    const shapes = await tx.query<FactShapeRow>(FACT_SHAPES, scoped);
    return { definition, sections: sections.rows, cited: cited.rows, shapes: shapes.rows };
  });
  if (!read.ok) return err(read.error);
  if (read.value === undefined) return ok(undefined);

  const coverage = await coverageOf(reader, tx, guideId);
  if (!coverage.ok) return err(coverage.error);
  if (coverage.value === undefined) return ok(undefined);
  const held = { ...read.value, coverage: coverage.value };
  const shown = shownTo(reader, held);
  const showing = new Set(shown.flatMap(({ row }) => (showsBrief(row) ? [row.write_up_id] : [])));
  const cited = await withEvidence(read.value.cited, evidenceOf, showing);
  if (!cited.ok) return err(cited.error);
  return ok(guideFrom(reader, guideId, held, shown, cited.value));
};
