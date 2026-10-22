import { z } from "zod";

import { readableClause, readableParameters } from "../access/index.ts";
import { record } from "../audit/index.ts";
import { withBundleWrite } from "../bundle/index.ts";
import {
  admit,
  attempt,
  declareAction,
  err,
  ok,
  ulid,
  type RefusalOf,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import type { Committed } from "../store/git/index.ts";
import { withMemberUnheld, type Tx } from "../store/postgres/index.ts";
import { definitionAt, type GuideDefinition } from "./definition.ts";
import { firstMatchesSql, type FirstMatch } from "./match.ts";
import {
  renderSkeleton,
  writeSkeleton,
  type GuideDoors,
  type SkeletonInclude,
  type SkeletonRefusal,
} from "./skeleton.ts";
import { recomputeWriteUpsIncluding } from "./visibility.ts";
import {
  EXPECTATION_UNMET,
  GUIDE_ACTIONS,
  insertIncludes,
  insertWriteUpVersions,
  SECTION_HOME,
  type IncludeRow,
} from "./write-ups.ts";

type IncludeAvailableInput = { readonly writeUpId: string };

const includeAvailableAction = declareAction({
  admits: { role: "Editor", purposes: [] },
  input: z.custom<IncludeAvailableInput>(),
  refuses: ["role-forbids", "not-found"],
});

type IncludeAvailableRefusal = RefusalOf<typeof includeAvailableAction> | SkeletonRefusal;

type AvailableIncluded =
  | { readonly included: 0 }
  | { readonly included: number; readonly sha: string };

type SectionWriteUpRow = {
  readonly guide_id: string;
  readonly section_id: string;
  readonly collection: string;
};

const SECTION_WRITE_UP = `
  SELECT w.guide_id, w.section_id, g.collection
    FROM write_up w
    JOIN guide_definition g ON g.workspace_id = w.workspace_id AND g.id = w.guide_id
   WHERE w.workspace_id = $1 AND w.id = $2 AND w.home = '${SECTION_HOME}'
     AND ${readableClause("w", 3)}`;

const SECTION_FACTS = `(SELECT id, section_id, ordinal, kind, tags, collection
                          FROM guide_expected_fact
                         WHERE workspace_id = $1 AND guide_id = $5 AND section_id = $6) f`;

type GuideIncludeRow = IncludeRow & { readonly sectionId: string };

const GUIDE_INCLUDES = `
  SELECT i.write_up_id AS "writeUpId", w.section_id AS "sectionId", i.id, i.iri,
         i.content_hash AS "contentHash", i.expected_fact_id AS "expectedFactId", i.ordinal,
         i.wording_heading AS "wordingHeading", i.wording_hash AS "wordingHash"
    FROM write_up_include i
    JOIN write_up w ON w.workspace_id = i.workspace_id AND w.id = i.write_up_id
   WHERE w.workspace_id = $1 AND w.guide_id = $2 AND w.home = '${SECTION_HOME}'
   ORDER BY i.write_up_id, i.ordinal`;

const LATEST_VERSION = `
  SELECT version, markdown FROM write_up_version
   WHERE workspace_id = $1 AND write_up_id = $2
   ORDER BY version DESC LIMIT 1`;

type Inclusion = {
  readonly writeUpId: string;
  readonly guideId: string;
  readonly sectionId: string;
  readonly definition: GuideDefinition;
  readonly standing: readonly GuideIncludeRow[];
  readonly added: readonly IncludeRow[];
  readonly next: { readonly version: number; readonly markdown: string };
};

const availableFor = async (
  reader: UserPrincipal,
  tx: Tx,
  writeUpId: string,
  section: SectionWriteUpRow,
): Promise<readonly FirstMatch[]> => {
  const found = await tx.query<FirstMatch>(
    firstMatchesSql({
      scope: 1,
      reader: 2,
      guideCollection: "$4",
      facts: SECTION_FACTS,
      besides: 7,
    }),
    [
      reader.workspaceId,
      ...readableParameters(reader),
      section.collection,
      section.guide_id,
      section.section_id,
      writeUpId,
    ],
  );
  return found.rows;
};

const addedFrom = (
  writeUpId: string,
  standing: readonly IncludeRow[],
  matches: readonly FirstMatch[],
): readonly IncludeRow[] => {
  const after = Math.max(-1, ...standing.map((include) => include.ordinal)) + 1;
  return matches.map((match, at) => ({
    id: ulid(),
    writeUpId,
    ordinal: after + at,
    iri: match.iri,
    contentHash: match.content_hash,
    expectedFactId: match.fact_id,
    wordingHeading: null,
    wordingHash: null,
  }));
};

const inclusionFor = async (
  reader: UserPrincipal,
  tx: Tx,
  writeUpId: string,
): Promise<Inclusion | undefined> => {
  const section = (
    await tx.query<SectionWriteUpRow>(SECTION_WRITE_UP, [
      reader.workspaceId,
      writeUpId,
      ...readableParameters(reader),
    ])
  ).rows[0];
  if (section === undefined) return undefined;
  const matches = await availableFor(reader, tx, writeUpId, section);
  const definition = await definitionAt(reader, tx, section.guide_id);
  if (definition === undefined) return undefined;
  const standing = await tx.query<GuideIncludeRow>(GUIDE_INCLUDES, [
    reader.workspaceId,
    section.guide_id,
  ]);
  const latest = await tx.query<{ version: number; markdown: string }>(LATEST_VERSION, [
    reader.workspaceId,
    writeUpId,
  ]);
  const own = standing.rows.filter((include) => include.writeUpId === writeUpId);
  return {
    writeUpId,
    guideId: section.guide_id,
    sectionId: section.section_id,
    definition,
    standing: standing.rows,
    added: addedFrom(writeUpId, own, matches),
    next: {
      version: (latest.rows[0]?.version ?? 0) + 1,
      markdown: latest.rows[0]?.markdown ?? "",
    },
  };
};

const CLEAR_WHEN_MET = `
  UPDATE write_up w SET needs_review = NULL
   WHERE w.workspace_id = $1 AND w.id = $2 AND w.needs_review = $3
     AND NOT EXISTS (
           SELECT 1 FROM guide_expected_fact f
            WHERE f.workspace_id = w.workspace_id AND f.guide_id = w.guide_id
              AND f.section_id = w.section_id
              AND f.at_least > (SELECT count(*) FROM write_up_include i
                                 WHERE i.workspace_id = w.workspace_id
                                   AND i.write_up_id = w.id AND i.expected_fact_id = f.id))`;

const withoutSection = (include: GuideIncludeRow): IncludeRow => ({
  writeUpId: include.writeUpId,
  id: include.id,
  iri: include.iri,
  contentHash: include.contentHash,
  expectedFactId: include.expectedFactId,
  ordinal: include.ordinal,
  wordingHeading: include.wordingHeading,
  wordingHash: include.wordingHash,
});

const landInclusion =
  (inclusion: Inclusion, auditEventId: string) =>
  async (fresh: UserPrincipal, tx: Tx, committed: Committed): Promise<void> => {
    const { writeUpId, guideId, added } = inclusion;
    await insertIncludes(fresh, tx, added);
    const own = inclusion.standing
      .filter((include) => include.writeUpId === writeUpId)
      .map(withoutSection);
    await insertWriteUpVersions(fresh, tx, [
      { writeUpId, ...inclusion.next, includes: [...own, ...added] },
    ]);
    await tx.query(CLEAR_WHEN_MET, [fresh.workspaceId, writeUpId, EXPECTATION_UNMET]);
    await recomputeWriteUpsIncluding(fresh, tx, { iris: added.map((include) => include.iri) });
    await record(fresh, tx, {
      id: auditEventId,
      action: GUIDE_ACTIONS.included,
      subjectId: guideId,
      detail: { guideId, writeUpId, included: added.length, commitSha: committed.sha },
    });
  };

const skeletonIncludesOf = (inclusion: Inclusion): readonly SkeletonInclude[] => [
  ...inclusion.standing,
  ...inclusion.added.map((include) => ({ ...include, sectionId: inclusion.sectionId })),
];

const included = async (
  principal: UserPrincipal,
  doors: GuideDoors,
  writeUpId: string,
  auditEventId: string,
): Promise<Result<AvailableIncluded, IncludeAvailableRefusal | Error>> => {
  const read = await attempt(() =>
    withMemberUnheld(principal, doors.postgres, (fresh, tx) => inclusionFor(fresh, tx, writeUpId)),
  );
  if (!read.ok) return err(read.error);
  if (!read.value.ok) return err(read.value.error);
  const inclusion = read.value.value;
  if (inclusion === undefined) return err("not-found");
  if (inclusion.added.length === 0) return ok({ included: 0 });

  const written = await writeSkeleton(principal, doors, {
    guideId: inclusion.guideId,
    content: renderSkeleton(inclusion.definition, skeletonIncludesOf(inclusion)),
    auditEventId,
    land: landInclusion(inclusion, auditEventId),
  });
  if (!written.ok) return err(written.error);
  if (!written.value.written) {
    return err(new Error(`guides: guide ${inclusion.guideId}'s skeleton stood unchanged`));
  }
  return ok({ included: inclusion.added.length, sha: written.value.sha });
};

export const includeAvailable = async (
  principal: UserPrincipal,
  doors: GuideDoors,
  input: IncludeAvailableInput,
): Promise<Result<AvailableIncluded, IncludeAvailableRefusal | Error>> => {
  const admitted = admit(includeAvailableAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const auditEventId = ulid();
  return withBundleWrite(principal, doors, () =>
    included(principal, doors, input.writeUpId, auditEventId),
  );
};
