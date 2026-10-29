import { z } from "zod";

import {
  AUDIENCE_EVERYONE,
  type NEEDS_REVIEW_REASONS,
  type WRITE_UP_HOMES,
} from "@better-answers/schema";

import type { Sensitivity } from "../access/index.ts";
import { action, declareActions } from "../audit/index.ts";
import { actorIdOf, type Principal, type UserPrincipal } from "../kernel/index.ts";
import { scopeClause, scopeParameter, type Tx } from "../store/postgres/index.ts";

export const SECTION_HOME = "section" satisfies (typeof WRITE_UP_HOMES)[number];

export const EXPECTATION_UNMET =
  "expectation-unmet" satisfies (typeof NEEDS_REVIEW_REASONS)[number];

const CONCEPT_CHANGED = "concept-changed" satisfies (typeof NEEDS_REVIEW_REASONS)[number];

const INTERNAL = "Internal" satisfies Sensitivity;

export const GUIDE_ACTIONS = declareActions("knowledge", {
  seeded: action("knowledge.guide.seeded", { guideId: "id", commitSha: "gitSha" }),
  included: action("knowledge.guide.included", {
    guideId: "id",
    writeUpId: "id",
    included: "count",
    commitSha: "gitSha",
  }),
});

const includeSnapshot = z.array(
  z.strictObject({
    id: z.string(),
    iri: z.string(),
    contentHash: z.string(),
    expectedFactId: z.string().nullable(),
    ordinal: z.number().int().nonnegative(),
    wordingHeading: z.string().nullable(),
    wordingHash: z.string().nullable(),
  }),
);

type SnapshotEntry = z.output<typeof includeSnapshot>[number];

export type IncludeRow = SnapshotEntry & { readonly writeUpId: string };

const snapshotEntryOf = (include: IncludeRow): SnapshotEntry => ({
  id: include.id,
  iri: include.iri,
  contentHash: include.contentHash,
  expectedFactId: include.expectedFactId,
  ordinal: include.ordinal,
  wordingHeading: include.wordingHeading,
  wordingHash: include.wordingHash,
});

export const insertIncludes = async (
  principal: UserPrincipal,
  tx: Tx,
  includes: readonly IncludeRow[],
): Promise<void> => {
  await tx.query(
    `INSERT INTO write_up_include (workspace_id, write_up_id, id, ordinal, iri, content_hash,
                                   expected_fact_id, wording_heading, wording_hash)
     SELECT $1, i."writeUpId", i.id, i.ordinal, i.iri, i."contentHash", i."expectedFactId",
            i."wordingHeading", i."wordingHash"
       FROM jsonb_to_recordset($2::jsonb)
         AS i("writeUpId" text, id text, ordinal int, iri text, "contentHash" text,
              "expectedFactId" text, "wordingHeading" text, "wordingHash" text)`,
    [principal.workspaceId, JSON.stringify(includes)],
  );
};

export type WriteUpVersion = {
  readonly writeUpId: string;
  readonly version: number;
  readonly markdown: string;

  readonly includes: readonly IncludeRow[];
};

export const insertWriteUpVersions = async (
  principal: UserPrincipal,
  tx: Tx,
  versions: readonly WriteUpVersion[],
): Promise<void> => {
  const rows = versions.map((version) => ({
    writeUpId: version.writeUpId,
    version: version.version,
    markdown: version.markdown,
    includes: includeSnapshot.parse(version.includes.map(snapshotEntryOf)),
  }));
  await tx.query(
    `INSERT INTO write_up_version (workspace_id, write_up_id, version, actor, markdown, includes)
     SELECT $1, v."writeUpId", v.version, $2, v.markdown, v.includes
       FROM jsonb_to_recordset($3::jsonb)
         AS v("writeUpId" text, version int, markdown text, includes jsonb)`,
    [principal.workspaceId, actorIdOf(principal), JSON.stringify(rows)],
  );
};

export type SectionWriteUp = {
  readonly id: string;
  readonly sectionId: string;
  readonly unmet: boolean;
};

export const leavesAFactUnmet = (
  facts: readonly { readonly id: string; readonly atLeast: number }[],
  includes: readonly Pick<IncludeRow, "expectedFactId">[],
): boolean =>
  facts.some(
    (fact) =>
      includes.filter((include) => include.expectedFactId === fact.id).length < fact.atLeast,
  );

export const insertSectionWriteUps = async (
  principal: UserPrincipal,
  tx: Tx,
  guideId: string,
  writeUps: readonly SectionWriteUp[],
): Promise<void> => {
  await tx.query(
    `INSERT INTO write_up (workspace_id, id, published_at, sensitivity, audience, audience_groups,
                           home, guide_id, section_id, needs_review)
     SELECT $1, w.id, now(), $7, $2, NULL, $3, $4, w."sectionId",
            CASE WHEN w.unmet THEN $5 END
       FROM jsonb_to_recordset($6::jsonb) AS w(id text, "sectionId" text, unmet boolean)`,
    [
      principal.workspaceId,
      AUDIENCE_EVERYONE,
      SECTION_HOME,
      guideId,
      EXPECTATION_UNMET,
      JSON.stringify(writeUps.map(({ id, sectionId, unmet }) => ({ id, sectionId, unmet }))),
      INTERNAL,
    ],
  );
};

export const flagWriteUpsCiting = async (
  principal: Principal,
  tx: Tx,
  input: { readonly iri: string; readonly contentHash: string },
): Promise<readonly string[]> => {
  const marked = await tx.query<{ id: string }>(
    `UPDATE write_up w SET needs_review = $4
      WHERE w.workspace_id = ${scopeClause(1)}
        AND (w.needs_review IS NULL OR w.needs_review = $5)
        AND EXISTS (SELECT 1 FROM write_up_include i
                     WHERE i.workspace_id = w.workspace_id AND i.write_up_id = w.id
                       AND i.iri = $2 AND i.content_hash <> $3)
    RETURNING w.id`,
    [scopeParameter(principal), input.iri, input.contentHash, CONCEPT_CHANGED, EXPECTATION_UNMET],
  );
  return marked.rows.map((row) => row.id);
};
