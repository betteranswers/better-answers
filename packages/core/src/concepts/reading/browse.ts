import { z } from "zod";

import { boundarySchemas, COLLECTION, ids, type ConceptIri } from "@better-answers/schema";
import { byCodeUnit } from "@better-answers/schema/code-unit";

import { readableClause, readableParameters } from "../../access/index.ts";
import {
  admit,
  ANY_ROLE,
  attempt,
  declareAction,
  err,
  type RefusalOf,
  type Result,
  type UserPrincipal,
} from "../../kernel/index.ts";
import type { Tx } from "../../store/postgres/index.ts";
import type { Frontmatter } from "../file.ts";
import {
  trustOf,
  trustWords,
  verificationOf,
  weakestTrust,
  type Trust,
  type VerificationRow,
} from "../trust.ts";
import { latestVerificationOf } from "./latest-verification.ts";

const CONCEPT_TYPE_PAGE_SIZE = 50;

type ConceptTypeCount = { readonly conceptType: string; readonly count: number };

type CollectionCount = {
  readonly collection: string | null;
  readonly count: number;
  readonly conceptTypes: readonly ConceptTypeCount[];
};

type KnowledgeTree = { readonly collections: readonly CollectionCount[] };

const readKnowledgeTreeAction = declareAction({
  admits: ANY_ROLE,
  input: z.object({}),
  refuses: ["role-forbids"],
});

const KNOWLEDGE_TREE = `SELECT c.collection, c.concept_type, count(*)::int AS count
    FROM concept_index c
   WHERE c.workspace_id = $1 AND ${readableClause("c", 2)}
   GROUP BY c.collection, c.concept_type`;

type ConceptTypeRow = {
  readonly collection: string | null;
  readonly concept_type: string;
  readonly count: number;
};

export const collectionOrder = (
  one: { readonly collection: string | null },
  other: { readonly collection: string | null },
): number => {
  if (one.collection === null) return 1;
  if (other.collection === null) return -1;
  return byCodeUnit(one.collection, other.collection);
};

const treeOf = (rows: readonly ConceptTypeRow[]): KnowledgeTree => {
  const conceptTypesIn = Map.groupBy(rows, (row) => row.collection);
  return {
    collections: [...conceptTypesIn]
      .map(([collection, held]) => ({
        collection,
        count: held.reduce((sum, row) => sum + row.count, 0),
        conceptTypes: held
          .map(({ concept_type: conceptType, count }) => ({ conceptType, count }))
          .toSorted((one, other) => byCodeUnit(one.conceptType, other.conceptType)),
      }))
      .toSorted(collectionOrder),
  };
};

export const readKnowledgeTree = async (
  principal: UserPrincipal,
  tx: Tx,
): Promise<Result<KnowledgeTree, RefusalOf<typeof readKnowledgeTreeAction> | Error>> => {
  const admitted = admit(readKnowledgeTreeAction, principal, {});
  if (!admitted.ok) return err(admitted.error);
  const reader = admitted.value;
  return attempt(async () => {
    const { rows } = await tx.query<ConceptTypeRow>(KNOWLEDGE_TREE, [
      reader.workspaceId,
      ...readableParameters(reader),
    ]);
    return treeOf(rows);
  });
};

const conceptColumns = boundarySchemas.conceptIndex.select.shape;

const conceptOfTypeCursor = z.strictObject({ title: conceptColumns.title, iri: ids.conceptIri });

type ConceptOfTypeCursor = z.output<typeof conceptOfTypeCursor>;

/** Not strict: tRPC's infinite query sends its `direction` beside the cursor. */
export const conceptsOfTypeInput = z.object({
  collection: z.string().regex(COLLECTION).nullable(),
  conceptType: conceptColumns.conceptType,
  cursor: conceptOfTypeCursor.nullish(),
});

export type ConceptsOfTypeInput = z.output<typeof conceptsOfTypeInput>;

type ConceptOfType = {
  readonly iri: ConceptIri;
  readonly title: string;
  readonly conceptType: string;
  readonly trust: Pick<Trust, "tier" | "status">;
  readonly trustWords: string;
};

type ConceptsOfType = {
  readonly concepts: readonly ConceptOfType[];
  readonly nextCursor: ConceptOfTypeCursor | null;
};

const readConceptsOfTypeAction = declareAction({
  admits: ANY_ROLE,
  input: conceptsOfTypeInput,
  refuses: ["role-forbids"],
});

const LATEST_VERIFICATION = latestVerificationOf("c");

const CONCEPTS_OF_TYPE = `SELECT c.iri, c.title, c.concept_type, c.status, c.frontmatter, c.content_hash,
              ${LATEST_VERIFICATION.columns}
         FROM concept_index c
         ${LATEST_VERIFICATION.joins}
        WHERE c.workspace_id = $1 AND ${readableClause("c", 2)}
          AND c.collection IS NOT DISTINCT FROM $4 AND c.concept_type = $5
          AND ($6::text IS NULL OR (c.title COLLATE "C", c.iri) > ($6 COLLATE "C", $7))
        ORDER BY c.title COLLATE "C", c.iri
        LIMIT $8`;

export type TrustRow = {
  readonly iri: string;
  readonly status: string;
  readonly frontmatter: Frontmatter;
  readonly content_hash: string;
} & VerificationRow;

type ConceptOfTypeRow = TrustRow & { readonly title: string; readonly concept_type: string };

export const trustOfRow = (row: TrustRow, judgedAt: Date): Trust =>
  trustOf(
    {
      status: row.status,
      frontmatter: row.frontmatter,
      contentHash: row.content_hash,
      verification: verificationOf(row),
    },
    judgedAt,
  );

const conceptOfTypeFrom = (row: ConceptOfTypeRow, judgedAt: Date): ConceptOfType => {
  const trust = trustOfRow(row, judgedAt);
  return {
    iri: ids.conceptIri.parse(row.iri),
    title: row.title,
    conceptType: row.concept_type,
    trust: { tier: trust.tier, status: trust.status },
    trustWords: trustWords(trust),
  };
};

const conceptsOfTypeFrom = (rows: readonly ConceptOfTypeRow[], judgedAt: Date): ConceptsOfType => {
  const page = rows.slice(0, CONCEPT_TYPE_PAGE_SIZE).map((row) => conceptOfTypeFrom(row, judgedAt));
  const last = page.at(-1);
  return {
    concepts: page,
    nextCursor:
      rows.length > CONCEPT_TYPE_PAGE_SIZE && last !== undefined
        ? { title: last.title, iri: last.iri }
        : null,
  };
};

export const readConceptsOfType = async (
  principal: UserPrincipal,
  tx: Tx,
  input: ConceptsOfTypeInput,
  judgedAt: Date,
): Promise<Result<ConceptsOfType, RefusalOf<typeof readConceptsOfTypeAction> | Error>> => {
  const admitted = admit(readConceptsOfTypeAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const reader = admitted.value;
  const { collection, conceptType, cursor } = input;
  return attempt(async () => {
    const { rows } = await tx.query<ConceptOfTypeRow>(CONCEPTS_OF_TYPE, [
      reader.workspaceId,
      ...readableParameters(reader),
      collection,
      conceptType,
      cursor?.title ?? null,
      cursor?.iri ?? null,
      CONCEPT_TYPE_PAGE_SIZE + 1,
    ]);
    return conceptsOfTypeFrom(rows, judgedAt);
  });
};

type CitedIris = readonly string[];

const sectionTrustsAction = declareAction({
  admits: ANY_ROLE,
  input: z.custom<readonly CitedIris[]>(),
  refuses: ["role-forbids"],
});

const TRUST_OF = `SELECT c.iri, c.status, c.frontmatter, c.content_hash, ${LATEST_VERIFICATION.columns}
    FROM concept_index c
    ${LATEST_VERIFICATION.joins}
   WHERE c.workspace_id = $1 AND ${readableClause("c", 2)} AND c.iri = ANY($4::text[])`;

export const readSectionTrusts = async (
  principal: UserPrincipal,
  tx: Tx,
  sections: readonly CitedIris[],
  judgedAt: Date,
): Promise<Result<readonly Trust[], RefusalOf<typeof sectionTrustsAction> | Error>> => {
  const admitted = admit(sectionTrustsAction, principal, sections);
  if (!admitted.ok) return err(admitted.error);
  const reader = admitted.value;
  return attempt(async () => {
    const { rows } = await tx.query<TrustRow>(TRUST_OF, [
      reader.workspaceId,
      ...readableParameters(reader),
      [...new Set(sections.flat())],
    ]);
    const trusts = new Map(rows.map((row) => [row.iri, trustOfRow(row, judgedAt)]));
    return sections.map((cited) => weakestTrust(cited.flatMap((iri) => trusts.get(iri) ?? [])));
  });
};
