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
  ok,
  type RefusalOf,
  type Result,
  type UserId,
  type UserPrincipal,
} from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import { collectionOwnerAdmits, type OwnerRefusal } from "./owners.ts";
import { collectionOrder, trustOfRow, type TrustRow } from "./reading/browse.ts";
import { latestVerificationOf } from "./reading/latest-verification.ts";
import { trustWords, ukLongDate, verifierWords, type Trust } from "./trust.ts";

const PAGE_SIZE = 50;

const SORT_COLUMNS = ["title", "kind", "collection", "owner", "checked"] as const;

type SortColumn = (typeof SORT_COLUMNS)[number];

/**
 * A concept with no value for the sort key sorts as the greatest, except that a never-checked
 * concept sorts as the oldest.
 */
const SORT_KEYS = {
  title: `c.title COLLATE "C"`,
  kind: `c.kind COLLATE "C"`,
  collection: `c.collection COLLATE "C"`,
  owner: `owner.name COLLATE "C"`,
  checked: `COALESCE((SELECT max(verified_at) FROM concept_verification
                        WHERE workspace_id = c.workspace_id AND iri = c.iri), '-infinity')`,
} as const satisfies Record<SortColumn, string>;

export const allKnowledgeInput = z.strictObject({
  collections: z.array(z.string().regex(COLLECTION)),
  kind: boundarySchemas.conceptIndex.select.shape.kind.optional(),
  sort: z.strictObject({ column: z.enum(SORT_COLUMNS), desc: z.boolean() }),
  page: z.int().min(1).default(1),
});

export type AllKnowledgeInput = z.output<typeof allKnowledgeInput>;

export type AllKnowledgeRow = {
  readonly iri: ConceptIri;
  readonly title: string;
  readonly kind: string;
  readonly collection: string | null;
  readonly trust: Pick<Trust, "tier" | "status">;
  readonly trustWords: string;
  readonly owner: { readonly id: UserId; readonly name: string; readonly own: boolean } | null;
  readonly checkedBy: string | null;
  readonly checkedOn: string | null;
};

export type AllKnowledge = {
  readonly rows: readonly AllKnowledgeRow[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: typeof PAGE_SIZE;
};

export type KindCounted = {
  readonly kind: string;
  readonly count: number;
  readonly collections: readonly { readonly collection: string | null; readonly count: number }[];
};

const readAllKnowledgeAction = declareAction({
  admits: ANY_ROLE,
  input: allKnowledgeInput,
  refuses: ["role-forbids", "owner-forbids"],
});

const readKindsAction = declareAction({
  admits: ANY_ROLE,
  input: z.object({}),
  refuses: ["role-forbids", "owner-forbids"],
});

export type CurationRefusal = RefusalOf<typeof readAllKnowledgeAction> | Error;

const ownerAdmitted = async (
  reader: UserPrincipal,
  tx: Tx,
): Promise<Result<UserPrincipal, OwnerRefusal | Error>> => {
  const refused = await attempt(() => collectionOwnerAdmits(reader, tx));
  if (!refused.ok) return err(refused.error);
  return refused.value === undefined ? ok(reader) : err(refused.value);
};

const READABLE_AND_FILTERED = `c.workspace_id = $1 AND ${readableClause("c", 2)}
          AND (cardinality($4::text[]) = 0 OR c.collection = ANY($4::text[]))
          AND ($5::text IS NULL OR c.kind = $5)`;

const LATEST_VERIFICATION = latestVerificationOf("page");

const pageQuery = ({ column, desc }: AllKnowledgeInput["sort"]): string => {
  const direction = desc ? "DESC" : "ASC";
  return `SELECT page.*, ${LATEST_VERIFICATION.columns}
    FROM (
      SELECT c.workspace_id, c.iri, c.title, c.kind, c.collection, c.status, c.frontmatter,
             c.content_hash,
             COALESCE(own.person_id, standing.person_id) AS owner_id,
             own.person_id IS NOT NULL AS owner_is_own,
             owner.name AS owner_name,
             ${SORT_KEYS[column]} AS sort_key,
             (count(*) OVER ())::int AS total
        FROM concept_index c
        LEFT JOIN concept_owner own
               ON own.workspace_id = c.workspace_id AND own.iri = c.iri
        LEFT JOIN concept_owner standing
               ON standing.workspace_id = c.workspace_id AND standing.collection = c.collection
        LEFT JOIN "user" owner ON owner.id = COALESCE(own.person_id, standing.person_id)
       WHERE ${READABLE_AND_FILTERED}
       ORDER BY sort_key ${direction}, c.iri
       LIMIT ${PAGE_SIZE} OFFSET $6
    ) page
    ${LATEST_VERIFICATION.joins}
   ORDER BY page.sort_key ${direction}, page.iri`;
};

const MATCHED = `SELECT count(*)::int AS total FROM concept_index c WHERE ${READABLE_AND_FILTERED}`;

type PageRow = TrustRow & {
  readonly title: string;
  readonly kind: string;
  readonly collection: string | null;
  readonly owner_id: UserId | null;
  readonly owner_is_own: boolean;
  readonly owner_name: string | null;
  readonly total: number;
};

const checkerOf = (trust: Trust): string | null => {
  switch (trust.tier) {
    case "human-reviewed":
      return verifierWords(trust.verifiedBy);
    case "machine-confirmed":
    case "unverified":
      return null;
  }
};

const rowOf = (row: PageRow, now: Date): AllKnowledgeRow => {
  const trust = trustOfRow(row, now);
  return {
    iri: ids.conceptIri.parse(row.iri),
    title: row.title,
    kind: row.kind,
    collection: row.collection,
    trust: { tier: trust.tier, status: trust.status },
    trustWords: trustWords(trust),
    owner:
      row.owner_id === null
        ? null
        : { id: row.owner_id, name: row.owner_name ?? "", own: row.owner_is_own },
    checkedBy: checkerOf(trust),
    checkedOn: trust.verifiedAt === null ? null : ukLongDate(trust.verifiedAt),
  };
};

const totalBehind = async (
  rows: readonly PageRow[],
  page: number,
  tx: Tx,
  filter: readonly unknown[],
): Promise<number> => {
  const first = rows[0];
  if (first !== undefined) return first.total;
  if (page === 1) return 0;
  const matched = await tx.query<{ total: number }>(MATCHED, [...filter]);
  return matched.rows[0]?.total ?? 0;
};

const pageRead = async (
  reader: UserPrincipal,
  tx: Tx,
  { collections, kind, sort, page }: AllKnowledgeInput,
  now: Date,
): Promise<AllKnowledge> => {
  const filter = [reader.workspaceId, ...readableParameters(reader), collections, kind ?? null];
  const { rows } = await tx.query<PageRow>(pageQuery(sort), [...filter, (page - 1) * PAGE_SIZE]);
  return {
    rows: rows.map((row) => rowOf(row, now)),
    total: await totalBehind(rows, page, tx, filter),
    page,
    pageSize: PAGE_SIZE,
  };
};

export const readAllKnowledge = async (
  principal: UserPrincipal,
  tx: Tx,
  input: AllKnowledgeInput,
  now: Date,
): Promise<Result<AllKnowledge, CurationRefusal>> => {
  const admitted = admit(readAllKnowledgeAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const reader = await ownerAdmitted(admitted.value, tx);
  if (!reader.ok) return err(reader.error);
  return attempt(() => pageRead(reader.value, tx, input, now));
};

const KINDS = `SELECT c.kind, c.collection, count(*)::int AS count
    FROM concept_index c
   WHERE c.workspace_id = $1 AND ${readableClause("c", 2)}
   GROUP BY c.kind, c.collection`;

type KindRow = {
  readonly kind: string;
  readonly collection: string | null;
  readonly count: number;
};

const kindsOf = (rows: readonly KindRow[]): readonly KindCounted[] =>
  [...Map.groupBy(rows, (row) => row.kind)]
    .map(([kind, held]) => ({
      kind,
      count: held.reduce((sum, row) => sum + row.count, 0),
      collections: held
        .map(({ collection, count }) => ({ collection, count }))
        .toSorted(collectionOrder),
    }))
    .toSorted((one, other) => byCodeUnit(one.kind, other.kind));

export const readKinds = async (
  principal: UserPrincipal,
  tx: Tx,
): Promise<Result<{ readonly kinds: readonly KindCounted[] }, CurationRefusal>> => {
  const admitted = admit(readKindsAction, principal, {});
  if (!admitted.ok) return err(admitted.error);
  const reader = await ownerAdmitted(admitted.value, tx);
  if (!reader.ok) return err(reader.error);
  return attempt(async () => {
    const { rows } = await tx.query<KindRow>(KINDS, [
      reader.value.workspaceId,
      ...readableParameters(reader.value),
    ]);
    return { kinds: kindsOf(rows) };
  });
};
