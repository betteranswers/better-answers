import { z } from "zod";

import {
  boundarySchemas,
  citedSourcesOf,
  conceptFrontmatter,
  type CitedSource,
  type TRUST_TIERS,
} from "@better-answers/schema";

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
import type { SourcedFootnote } from "./renderer.ts";
import { SECTION_HOME } from "./write-ups.ts";

type TrustTier = (typeof TRUST_TIERS)[number];

const actionThresholdOf = (held: TrustTier | null | undefined): TrustTier =>
  held ?? "human-reviewed";

const briefToCopyInput = z.strictObject({
  writeUpId: boundarySchemas.writeUp.select.shape.id,
  version: boundarySchemas.writeUpVersion.select.shape.version.exactOptional(),
});

type BriefToCopyInput = z.input<typeof briefToCopyInput>;

const briefToCopyAction = declareAction({
  admits: ANY_ROLE,
  input: z.custom<BriefToCopyInput>(),
  refuses: ["role-forbids"],
});

export type BriefToCopy = {
  readonly guideId: string;
  readonly version: number;
  readonly markdown: string;
  readonly includes: readonly SourcedFootnote[];
};

type BriefRow = {
  readonly guideId: string;
  readonly version: number;
  readonly markdown: string;
};

const BRIEF = `
  WITH RECURSIVE withheld (guide_id, id) AS (
    SELECT guide_id, id FROM guide_section WHERE workspace_id = $1 AND hidden
    UNION
    SELECT s.guide_id, s.id
      FROM guide_section s
      JOIN withheld h ON h.guide_id = s.guide_id AND h.id = s.parent_id
     WHERE s.workspace_id = $1
  )
  SELECT w.guide_id AS "guideId", v.version, v.markdown
    FROM write_up w
    JOIN LATERAL (SELECT version, markdown FROM write_up_version
                   WHERE workspace_id = w.workspace_id AND write_up_id = w.id
                     AND ($5::int IS NULL OR version = $5)
                   ORDER BY version DESC LIMIT 1) v ON true
   WHERE w.workspace_id = $1 AND w.id = $2 AND w.home = '${SECTION_HOME}'
     AND ${readableClause("w", 3)}
     AND ($3 = 'Admin' OR NOT EXISTS (SELECT 1 FROM withheld h
                                       WHERE h.guide_id = w.guide_id AND h.id = w.section_id))`;

type IncludeRow = {
  readonly label: string;
  readonly iri: string;
  readonly title: string;
  readonly frontmatter: unknown;
  readonly wording: string | null;
};

const INCLUDES = `
  SELECT i.id AS label, i.iri, c.title, c.frontmatter, i."wordingHeading" AS wording
    FROM write_up_version v
    CROSS JOIN LATERAL jsonb_to_recordset(v.includes)
      AS i(id text, iri text, ordinal int, "wordingHeading" text)
    JOIN concept_index c ON c.workspace_id = v.workspace_id AND c.iri = i.iri
   WHERE v.workspace_id = $1 AND v.write_up_id = $2 AND v.version = $5
     AND ${readableClause("c", 3)}
   ORDER BY i.ordinal, i.id`;

const sourcedOf = ({ frontmatter, ...footnote }: IncludeRow): SourcedFootnote => {
  const sources: readonly CitedSource[] = citedSourcesOf(
    conceptFrontmatter.parse(frontmatter)["sources"],
  );
  return { ...footnote, sources };
};

export const briefToCopy = async (
  principal: UserPrincipal,
  tx: Tx,
  input: BriefToCopyInput,
): Promise<Result<BriefToCopy | undefined, RefusalOf<typeof briefToCopyAction> | Error>> => {
  const admitted = admit(briefToCopyAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const reader = admitted.value;
  const readable = readableParameters(reader);

  return attempt(async () => {
    const brief = (
      await tx.query<BriefRow>(BRIEF, [
        reader.workspaceId,
        input.writeUpId,
        ...readable,
        input.version ?? null,
      ])
    ).rows[0];
    if (brief === undefined) return undefined;
    const includes = await tx.query<IncludeRow>(INCLUDES, [
      reader.workspaceId,
      input.writeUpId,
      ...readable,
      brief.version,
    ]);
    return { ...brief, includes: includes.rows.map(sourcedOf) };
  });
};

const THRESHOLD = `SELECT action_threshold AS threshold FROM guide_role
   WHERE workspace_id = $1 AND guide_id = $2 AND role = $3`;

const actionThresholdAction = declareAction({
  admits: ANY_ROLE,
  input: z.custom<string>(),
  refuses: ["role-forbids"],
});

export const readActionThreshold = async (
  principal: UserPrincipal,
  tx: Tx,
  guideId: string,
): Promise<Result<TrustTier, RefusalOf<typeof actionThresholdAction> | Error>> => {
  const admitted = admit(actionThresholdAction, principal, guideId);
  if (!admitted.ok) return err(admitted.error);
  const reader = admitted.value;
  const read = await attempt(() =>
    tx.query<{ readonly threshold: TrustTier }>(THRESHOLD, [
      reader.workspaceId,
      guideId,
      reader.role,
    ]),
  );
  return read.ok ? ok(actionThresholdOf(read.value.rows[0]?.threshold)) : err(read.error);
};
