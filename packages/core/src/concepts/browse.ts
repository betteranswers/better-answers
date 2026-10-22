import { z } from "zod";

import { boundarySchemas, COLLECTION, ids, type ConceptIri } from "@better-answers/schema";
import { byCodeUnit } from "@better-answers/schema/code-unit";

import { readableClause, readableParameters } from "../access/index.ts";
import {
  admit,
  ANY_ROLE,
  attempt,
  declareAction,
  err,
  type RefusalOf,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import type { Frontmatter } from "./file.ts";
import {
  latestVerificationOf,
  trustOf,
  trustWords,
  verificationOf,
  VERIFICATION_COLUMNS,
  type VerificationRow,
} from "./trust.ts";

const BRANCH_PAGE_SIZE = 50;

type KindCount = { readonly kind: string; readonly count: number };

type CollectionCount = {
  readonly collection: string | null;
  readonly count: number;
  readonly kinds: readonly KindCount[];
};

type KnowledgeTree = { readonly collections: readonly CollectionCount[] };

const readKnowledgeTreeAction = declareAction({
  admits: ANY_ROLE,
  input: z.object({}),
  refuses: ["role-forbids"],
});

const KNOWLEDGE_TREE = `SELECT c.collection, c.kind, count(*)::int AS count
    FROM concept_index c
   WHERE c.workspace_id = $1 AND ${readableClause("c", 2)}
   GROUP BY c.collection, c.kind`;

type KindRow = {
  readonly collection: string | null;
  readonly kind: string;
  readonly count: number;
};

const collectionOrder = (one: CollectionCount, other: CollectionCount): number => {
  if (one.collection === null) return 1;
  if (other.collection === null) return -1;
  return byCodeUnit(one.collection, other.collection);
};

const treeOf = (rows: readonly KindRow[]): KnowledgeTree => {
  const kindsIn = Map.groupBy(rows, (row) => row.collection);
  return {
    collections: [...kindsIn]
      .map(([collection, held]) => ({
        collection,
        count: held.reduce((sum, row) => sum + row.count, 0),
        kinds: held
          .map(({ kind, count }) => ({ kind, count }))
          .toSorted((one, other) => byCodeUnit(one.kind, other.kind)),
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
    const { rows } = await tx.query<KindRow>(KNOWLEDGE_TREE, [
      reader.workspaceId,
      ...readableParameters(reader),
    ]);
    return treeOf(rows);
  });
};

const conceptColumns = boundarySchemas.conceptIndex.select.shape;

const branchCursor = z.strictObject({ title: conceptColumns.title, iri: ids.conceptIri });

type BranchCursor = z.output<typeof branchCursor>;

/** Not strict: tRPC's infinite query sends its `direction` beside the cursor. */
export const knowledgeBranchInput = z.object({
  collection: z.string().regex(COLLECTION).nullable(),
  kind: conceptColumns.kind,
  cursor: branchCursor.nullish(),
});

export type KnowledgeBranchInput = z.output<typeof knowledgeBranchInput>;

type BranchConcept = {
  readonly iri: ConceptIri;
  readonly title: string;
  readonly kind: string;
  readonly trustWords: string;
};

type KnowledgeBranch = {
  readonly concepts: readonly BranchConcept[];
  readonly nextCursor: BranchCursor | null;
};

const readKnowledgeBranchAction = declareAction({
  admits: ANY_ROLE,
  input: knowledgeBranchInput,
  refuses: ["role-forbids"],
});

const KNOWLEDGE_BRANCH = `SELECT c.iri, c.title, c.kind, c.status, c.frontmatter, c.content_hash,
              ${VERIFICATION_COLUMNS}
         FROM concept_index c
         ${latestVerificationOf("c")}
        WHERE c.workspace_id = $1 AND ${readableClause("c", 2)}
          AND c.collection IS NOT DISTINCT FROM $4 AND c.kind = $5
          AND ($6::text IS NULL OR (c.title COLLATE "C", c.iri) > ($6 COLLATE "C", $7))
        ORDER BY c.title COLLATE "C", c.iri
        LIMIT $8`;

type BranchRow = {
  readonly iri: string;
  readonly title: string;
  readonly kind: string;
  readonly status: string;
  readonly frontmatter: Frontmatter;
  readonly content_hash: string;
} & VerificationRow;

const branchConceptOf = (row: BranchRow, now: Date): BranchConcept => ({
  iri: ids.conceptIri.parse(row.iri),
  title: row.title,
  kind: row.kind,
  trustWords: trustWords(
    trustOf(
      {
        status: row.status,
        frontmatter: row.frontmatter,
        contentHash: row.content_hash,
        verification: verificationOf(row),
      },
      now,
    ),
  ),
});

const branchOf = (rows: readonly BranchRow[], now: Date): KnowledgeBranch => {
  const page = rows.slice(0, BRANCH_PAGE_SIZE).map((row) => branchConceptOf(row, now));
  const last = page.at(-1);
  return {
    concepts: page,
    nextCursor:
      rows.length > BRANCH_PAGE_SIZE && last !== undefined
        ? { title: last.title, iri: last.iri }
        : null,
  };
};

/** `now` decides which concepts are past their shelf life, as their trust words say. */
export const readKnowledgeBranch = async (
  principal: UserPrincipal,
  tx: Tx,
  input: KnowledgeBranchInput,
  now: Date,
): Promise<Result<KnowledgeBranch, RefusalOf<typeof readKnowledgeBranchAction> | Error>> => {
  const admitted = admit(readKnowledgeBranchAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const reader = admitted.value;
  const { collection, kind, cursor } = input;
  return attempt(async () => {
    const { rows } = await tx.query<BranchRow>(KNOWLEDGE_BRANCH, [
      reader.workspaceId,
      ...readableParameters(reader),
      collection,
      kind,
      cursor?.title ?? null,
      cursor?.iri ?? null,
      BRANCH_PAGE_SIZE + 1,
    ]);
    return branchOf(rows, now);
  });
};
