import { z } from "zod";

import { COLLECTION, IRI } from "@better-answers/schema";

import { readableParameters } from "../access/index.ts";
import { record } from "../audit/index.ts";
import { withBundleWrite } from "../bundle/index.ts";
import {
  actorIdOf,
  admit,
  ADMIN_ALONE,
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
import { definitionOf, guideRowsOf, insertGuideRows, type GuideRows } from "./definition.ts";
import { firstMatchesSql, type FirstMatch } from "./match.ts";
import {
  guideSkeleton,
  renderSkeleton,
  skeletonOf,
  writeSkeleton,
  type GuideDoors,
  type SkeletonRefusal,
} from "./skeleton.ts";
import { TEMPLATES, type Template } from "./templates/index.ts";
import { recomputeWriteUpsIncluding } from "./visibility.ts";
import {
  GUIDE_ACTIONS,
  insertIncludes,
  insertSectionWriteUps,
  insertWriteUpVersions,
  leavesAFactUnmet,
  type IncludeRow,
  type SectionWriteUp,
} from "./write-ups.ts";

type SeedGuideInput = {
  readonly templateId: string;
  readonly collection: string;
  readonly subjectIri: string | null;
};

const seedGuideAction = declareAction({
  admits: ADMIN_ALONE,
  input: z.custom<SeedGuideInput>(),
  refuses: ["role-forbids", "malformed"],
});

type SeedGuideRefusal = RefusalOf<typeof seedGuideAction> | SkeletonRefusal;

type GuideSeeded = {
  readonly guideId: string;
  readonly sha: string;
  readonly auditEventId: string;
};

const templateFor = (input: SeedGuideInput): Template | undefined =>
  COLLECTION.test(input.collection) && (input.subjectIri === null || IRI.test(input.subjectIri))
    ? TEMPLATES.get(input.templateId)
    : undefined;

const FACTS_AS_GIVEN = `jsonb_to_recordset($5::jsonb)
  AS f(id text, section_id text, ordinal int, kind text, tags text[], collection text)`;

const firstMatchesFor = async (
  reader: UserPrincipal,
  tx: Tx,
  rows: GuideRows,
): Promise<readonly FirstMatch[]> => {
  const facts = rows.facts.map((fact) => ({
    id: fact.id,
    section_id: fact.sectionId,
    ordinal: fact.ordinal,
    kind: fact.kind,
    tags: fact.tags,
    collection: fact.collection,
  }));
  const found = await tx.query<FirstMatch>(
    firstMatchesSql({ scope: 1, reader: 2, guideCollection: "$4", facts: FACTS_AS_GIVEN }),
    [
      reader.workspaceId,
      ...readableParameters(reader),
      rows.definition.collection,
      JSON.stringify(facts),
    ],
  );
  return found.rows;
};

type PlannedWriteUp = SectionWriteUp & { readonly includes: readonly IncludeRow[] };

const plannedWriteUps = (
  rows: GuideRows,
  matches: readonly FirstMatch[],
  mint: () => string,
): readonly PlannedWriteUp[] =>
  rows.sections.map((section) => {
    const id = mint();
    const includes = matches
      .filter((match) => match.section_id === section.id)
      .map((match, ordinal) => ({
        id: mint(),
        writeUpId: id,
        ordinal,
        iri: match.iri,
        contentHash: match.content_hash,
        expectedFactId: match.fact_id,
        wordingHeading: null,
        wordingHash: null,
      }));
    const unmet = leavesAFactUnmet(
      rows.facts.filter((fact) => fact.sectionId === section.id),
      includes,
    );
    return { id, sectionId: section.id, unmet, includes };
  });

type Seeding = {
  readonly rows: GuideRows;
  readonly writeUps: readonly PlannedWriteUp[];
  readonly auditEventId: string;
};

const skeletonIncludesOf = (writeUps: readonly PlannedWriteUp[]) =>
  writeUps.flatMap((writeUp) =>
    writeUp.includes.map(({ iri, ordinal }) => ({ sectionId: writeUp.sectionId, iri, ordinal })),
  );

const landSeeding =
  (seeding: Seeding) =>
  async (fresh: UserPrincipal, tx: Tx, committed: Committed): Promise<void> => {
    const { rows, writeUps, auditEventId } = seeding;
    const guideId = rows.definition.id;
    const content = guideSkeleton.parse(
      skeletonOf(definitionOf(rows), skeletonIncludesOf(writeUps)),
    );
    await insertGuideRows(fresh, tx, rows);
    await tx.query(
      `INSERT INTO guide_definition_version (workspace_id, guide_id, version, actor, content)
       VALUES ($1, $2, 1, $3, $4)`,
      [fresh.workspaceId, guideId, actorIdOf(fresh), JSON.stringify(content)],
    );
    await insertSectionWriteUps(fresh, tx, guideId, writeUps);
    const includes = writeUps.flatMap((writeUp) => writeUp.includes);
    await insertIncludes(fresh, tx, includes);
    await insertWriteUpVersions(
      fresh,
      tx,
      writeUps.map((writeUp) => ({
        writeUpId: writeUp.id,
        version: 1,
        markdown: "",
        includes: writeUp.includes,
      })),
    );
    await recomputeWriteUpsIncluding(fresh, tx, { iris: includes.map((include) => include.iri) });
    await record(fresh, tx, {
      id: auditEventId,
      action: GUIDE_ACTIONS.seeded,
      subjectId: guideId,
      detail: { guideId, commitSha: committed.sha },
    });
  };

const seeded = async (
  principal: UserPrincipal,
  doors: GuideDoors,
  rows: GuideRows,
  auditEventId: string,
): Promise<Result<GuideSeeded, SeedGuideRefusal | Error>> => {
  const matched = await attempt(() =>
    withMemberUnheld(principal, doors.postgres, (fresh, tx) => firstMatchesFor(fresh, tx, rows)),
  );
  if (!matched.ok) return err(matched.error);
  if (!matched.value.ok) return err(matched.value.error);
  const writeUps = plannedWriteUps(rows, matched.value.value, ulid);
  const guideId = rows.definition.id;

  const written = await writeSkeleton(principal, doors, {
    guideId,
    content: renderSkeleton(definitionOf(rows), skeletonIncludesOf(writeUps)),
    auditEventId,
    land: landSeeding({ rows, writeUps, auditEventId }),
  });
  if (!written.ok) return err(written.error);
  if (!written.value.written) {
    return err(new Error(`guides: a skeleton already stood at new guide ${guideId}'s path`));
  }
  return ok({ guideId, sha: written.value.sha, auditEventId });
};

export const seedGuide = async (
  principal: UserPrincipal,
  doors: GuideDoors,
  input: SeedGuideInput,
): Promise<Result<GuideSeeded, SeedGuideRefusal | Error>> => {
  const admitted = admit(seedGuideAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const template = templateFor(input);
  if (template === undefined) return err("malformed");

  const auditEventId = ulid();
  return withBundleWrite(principal, doors, () =>
    seeded(
      principal,
      doors,
      guideRowsOf(
        template,
        { guideId: ulid(), collection: input.collection, subjectIri: input.subjectIri },
        ulid,
      ),
      auditEventId,
    ),
  );
};
