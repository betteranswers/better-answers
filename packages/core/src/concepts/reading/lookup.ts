import { z } from "zod";

import {
  anyWordMatch,
  corpusCounts,
  ids,
  QUERY_WORDS,
  type ConceptIri,
  type CorpusCounts,
  type MatchBound,
  type MatchStrength,
} from "@better-answers/schema";

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
import { type Tx } from "../../store/postgres/index.ts";
import { type Frontmatter } from "../file.ts";
import {
  trustOf,
  trustWords,
  verificationOf,
  type ConceptVerification,
  type Trust,
  type VerificationRow,
} from "../trust.ts";
import { latestVerificationOf } from "./latest-verification.ts";
import {
  bodyLinksOf,
  paneOf,
  projectedFrontmatter,
  relationsOf,
  resolvedSourcesOf,
  type BodyLink,
  type EvidencePane,
  type PassageNamer,
  type PassageReader,
  type Relation,
} from "./read.ts";

export type OpenedConcept = {
  readonly iri: ConceptIri;
  readonly path: string;
  readonly collection: string | null;
  readonly kind: string;
  readonly title: string;
  readonly frontmatter: Frontmatter;
  readonly body: string;
  readonly status: string;
  readonly contentHash: string;
  readonly commitSha: string;
  readonly verification: ConceptVerification | undefined;
};

type ConceptRow = {
  readonly iri: string;
  readonly path: string;
  readonly collection: string | null;
  readonly kind: string;
  readonly title: string;
  readonly frontmatter: Frontmatter;
  readonly body: string;
  readonly status: string;
  readonly content_hash: string;
  readonly commit_sha: string;
} & VerificationRow;

const LATEST_VERIFICATION = latestVerificationOf("c");

const conceptSelect = (
  ranked: { readonly columns: string; readonly joins: string } | undefined,
): string => `SELECT c.iri, c.path, c.collection, c.kind, c.title, c.frontmatter, c.body, c.status,
              c.content_hash, c.commit_sha,
              ${LATEST_VERIFICATION.columns}${ranked === undefined ? "" : `, ${ranked.columns}`}
         FROM concept_index c
         ${ranked?.joins ?? ""}
         ${LATEST_VERIFICATION.joins}
        WHERE c.workspace_id = $1 AND ${readableClause("c", 2)}`;

const CONCEPT_SELECT = conceptSelect(undefined);

const openedOf = (row: ConceptRow): OpenedConcept => ({
  iri: ids.conceptIri.parse(row.iri),
  path: row.path,
  collection: row.collection,
  kind: row.kind,
  title: row.title,
  frontmatter: row.frontmatter,
  body: row.body,
  status: row.status,
  contentHash: row.content_hash,
  commitSha: row.commit_sha,
  verification: verificationOf(row),
});

const conceptByIriAction = declareAction({
  admits: ANY_ROLE,
  input: z.custom<ConceptIri>(),
  refuses: ["role-forbids"],
});

export const conceptByIri = async (
  principal: UserPrincipal,
  tx: Tx,
  iri: ConceptIri,
): Promise<Result<OpenedConcept | undefined, RefusalOf<typeof conceptByIriAction> | Error>> => {
  const admitted = admit(conceptByIriAction, principal, iri);
  if (!admitted.ok) return err(admitted.error);
  const reader = admitted.value;

  return attempt(async () => {
    const { rows } = await tx.query<ConceptRow>(`${CONCEPT_SELECT} AND c.iri = $4`, [
      reader.workspaceId,
      ...readableParameters(reader),
      iri,
    ]);
    const row = rows[0];
    return row === undefined ? undefined : openedOf(row);
  });
};

const conceptsByIrisAction = declareAction({
  admits: ANY_ROLE,
  input: z.custom<readonly ConceptIri[]>(),
  refuses: ["role-forbids"],
});

export const conceptsByIris = async (
  principal: UserPrincipal,
  tx: Tx,
  iris: readonly ConceptIri[],
): Promise<Result<readonly OpenedConcept[], RefusalOf<typeof conceptsByIrisAction> | Error>> => {
  const admitted = admit(conceptsByIrisAction, principal, iris);
  if (!admitted.ok) return err(admitted.error);
  const reader = admitted.value;

  return attempt(async () => {
    const { rows } = await tx.query<ConceptRow>(
      `${CONCEPT_SELECT} AND c.iri = ANY($4::text[]) ORDER BY c.iri`,
      [reader.workspaceId, ...readableParameters(reader), iris],
    );
    return rows.map((row) => openedOf(row));
  });
};

type ReadRow = ConceptRow & {
  readonly shared_by: string | null;
  readonly shared_at: Date | null;
};

const CONCEPT_READ = `${conceptSelect({
  columns: "o.actor AS shared_by, o.recorded_at AS shared_at",
  joins: `LEFT JOIN concept_sensitivity_override o
                 ON o.workspace_id = c.workspace_id AND o.iri = c.iri`,
})} AND c.iri = $4`;

export type ConceptRead = {
  readonly iri: ConceptIri;
  readonly frontmatter: Frontmatter;
  readonly body: string;
  readonly trust: Trust;
  readonly trustWords: string;
  readonly pane: EvidencePane;
  readonly relations: readonly Relation[];
  readonly bodyLinks: readonly BodyLink[];
};

const sharerOfRow = (row: ReadRow) =>
  // Stryker disable next-line ConditionalExpression,LogicalOperator: the override's actor and recorded_at are NOT NULL in one joined row; hides the condition → true, killed in concept-read.test.ts
  row.shared_by === null || row.shared_at === null
    ? undefined
    : { actor: row.shared_by, at: row.shared_at };

export const readConcept = async (
  principal: UserPrincipal,
  tx: Tx,
  iri: ConceptIri,
  reads: {
    readonly passageAt: PassageReader;
    readonly namesPassage: PassageNamer;
    readonly now: Date;
  },
): Promise<Result<ConceptRead | undefined>> => {
  const read = await attempt(() =>
    tx.query<ReadRow>(CONCEPT_READ, [principal.workspaceId, ...readableParameters(principal), iri]),
  );
  if (!read.ok) return err(read.error);
  const [row] = read.value.rows;
  if (row === undefined) return ok(undefined);
  const concept = openedOf(row);
  const sources = await resolvedSourcesOf(
    { principal, tx, passageAt: reads.passageAt, namesPassage: reads.namesPassage },
    concept.frontmatter,
  );
  if (!sources.ok) return err(sources.error);
  const relations = await relationsOf(principal, tx, concept.iri);
  if (!relations.ok) return err(relations.error);
  const bodyLinks = await bodyLinksOf(principal, tx, concept);
  if (!bodyLinks.ok) return err(bodyLinks.error);
  const trust = trustOf(concept, reads.now);
  return ok({
    iri: concept.iri,
    frontmatter: projectedFrontmatter(concept.frontmatter, sources.value),
    body: concept.body,
    trust,
    trustWords: trustWords(trust),
    pane: paneOf(sources.value, sharerOfRow(row)),
    relations: relations.value,
    bodyLinks: bodyLinks.value,
  });
};

export const evidenceOf = async (
  principal: UserPrincipal,
  tx: Tx,
  frontmatter: Frontmatter,
  reads: { readonly passageAt: PassageReader; readonly namesPassage: PassageNamer },
): Promise<Result<EvidencePane["evidence"]>> => {
  const sources = await resolvedSourcesOf({ principal, tx, ...reads }, frontmatter);
  return sources.ok ? ok(sources.value.map((source) => source.item)) : err(sources.error);
};

export const corpusCountsOf = (
  tx: Tx,
  documents: string,
  parameters: readonly unknown[],
  query: string,
): Promise<Result<CorpusCounts>> =>
  attempt(async () => {
    const words = await tx.query<{ readonly word: string }>(QUERY_WORDS, [query]);
    if (words.rows.length === 0) return { size: 0, frequencies: [] };
    const counted = await tx.query<CorpusCounts>(
      corpusCounts(documents, words.rows.length, parameters.length + 1),
      [...parameters, ...words.rows.map(({ word }) => word)],
    );
    const [counts] = counted.rows;
    if (counts === undefined) throw new Error("a count answered no row");
    return counts;
  });

export const conceptCountsOf = (
  principal: UserPrincipal,
  tx: Tx,
  query: string,
): Promise<Result<CorpusCounts>> =>
  corpusCountsOf(
    tx,
    `SELECT d.search FROM concept_index d WHERE d.workspace_id = $1 AND ${readableClause("d", 2)}`,
    [principal.workspaceId, ...readableParameters(principal)],
    query,
  );

const MATCH = anyWordMatch("c.search", "$4", ["c.iri"], { size: "$5", frequencies: "$6" });

const matchingConcepts = (strength: MatchStrength, narrowed: boolean, after: boolean): string => {
  const bound = narrowed ? 9 : 8;
  const placed = (at: number): `$${number}` => `$${bound + at}`;
  return `${conceptSelect(MATCH)}
      AND ${MATCH.matches}
      AND ${MATCH.strength(strength)}
      ${narrowed ? "AND c.collection = ANY($8::text[])" : ""}
      ${after ? `AND ${MATCH.after({ weight: placed(0), rank: placed(1), key: [placed(2)] })}` : ""}
    ORDER BY ${MATCH.order}
    LIMIT $7`;
};

export type ConceptBound = MatchBound<ConceptIri>;

type ConceptFound = { readonly concept: OpenedConcept; readonly bound: ConceptBound };

type MatchingConceptRow = ConceptRow & { readonly weight: number; readonly rank: number };

export const findConcepts = async (
  principal: UserPrincipal,
  tx: Tx,
  input: ConceptSearch & { readonly counts?: CorpusCounts | undefined },
): Promise<Result<readonly ConceptFound[]>> => {
  const counts =
    input.counts === undefined
      ? await conceptCountsOf(principal, tx, input.query)
      : ok(input.counts);
  return counts.ok ? conceptsWeighed(principal, tx, input, counts.value) : counts;
};

type ConceptSearch = {
  readonly query: string;
  readonly strength: MatchStrength;
  readonly limit: number;
  readonly after?: ConceptBound | undefined;
  readonly collections?: readonly string[] | undefined;
};

const conceptsWeighed = (
  principal: UserPrincipal,
  tx: Tx,
  input: ConceptSearch,
  counts: CorpusCounts,
): Promise<Result<readonly ConceptFound[]>> =>
  attempt(async () => {
    const { after, collections } = input;
    const { rows } = await tx.query<MatchingConceptRow>(
      matchingConcepts(input.strength, collections !== undefined, after !== undefined),
      [
        principal.workspaceId,
        ...readableParameters(principal),
        input.query,
        counts.size,
        counts.frequencies,
        input.limit,
        ...(collections === undefined ? [] : [collections]),
        ...(after === undefined ? [] : [after.weight, after.rank, after.key]),
      ],
    );
    return rows.map((row) => {
      const concept = openedOf(row);
      return { concept, bound: { weight: row.weight, rank: row.rank, key: concept.iri } };
    });
  });

const readableCollectionsAction = declareAction({
  admits: ANY_ROLE,
  input: z.object({}),
  refuses: ["role-forbids"],
});

export const readableCollections = async (
  principal: UserPrincipal,
  tx: Tx,
): Promise<Result<readonly string[], RefusalOf<typeof readableCollectionsAction> | Error>> => {
  const admitted = admit(readableCollectionsAction, principal, {});
  if (!admitted.ok) return err(admitted.error);
  const reader = admitted.value;

  return attempt(async () => {
    const { rows } = await tx.query<{ readonly collection: string }>(
      `SELECT DISTINCT c.collection
         FROM concept_index c
        WHERE c.workspace_id = $1 AND ${readableClause("c", 2)}
          AND c.collection IS NOT NULL
        ORDER BY c.collection`,
      [reader.workspaceId, ...readableParameters(reader)],
    );
    return rows.map((row) => row.collection);
  });
};

export const evidenceForAReadableConcept = (alias: string, roleParameter: number): string =>
  `EXISTS (SELECT 1
             FROM concept_evidence ce
             JOIN concept_index ci ON ci.workspace_id = ce.workspace_id AND ci.iri = ce.iri
            WHERE ce.workspace_id = ${alias}.workspace_id
              AND ce.source_document_id = ${alias}.source_document_id
              AND ${readableClause("ci", roleParameter)})`;
