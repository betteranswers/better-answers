import type pg from "pg";

import {
  AUDIENCE_GROUPS,
  CONCEPT_DRAFT_STATUS,
  ids,
  type ConceptIri,
  type SENSITIVITIES,
} from "@better-answers/schema";
import type { MigratedPostgres, TestData } from "@better-answers/schema/testing";

import type { Role, UserPrincipal } from "../../src/kernel/index.ts";
import { seedingWith } from "../support/suite-postgres.ts";
import { principalFor } from "./workspace-with-bundle.ts";

type Check = { readonly actor: string; readonly at: Date };

export type Shelved = {
  readonly path: string;
  readonly iri?: ConceptIri;
  readonly conceptType?: string;
  readonly title?: string;
  readonly sensitivity?: (typeof SENSITIVITIES)[number];
  readonly audienceGroups?: readonly string[];
  readonly draft?: true;
  readonly deprecated?: true;
  readonly staleAfter?: string;
  readonly checks?: readonly Check[];
};

const audienceOf = (groups: readonly string[] | undefined) =>
  groups === undefined ? {} : { audience: AUDIENCE_GROUPS, audienceGroups: [...groups] };

const draftOf = (draft: true | undefined) =>
  draft === undefined ? {} : { status: CONCEPT_DRAFT_STATUS, publishedAt: null };

const deprecatedOf = (deprecated: true | undefined) =>
  deprecated === undefined ? {} : { status: "deprecated" as const };

const shelvedWith = async (
  seed: TestData,
  workspaceId: string,
  commitSha: string,
  shelved: Shelved,
): Promise<ConceptIri> => {
  const {
    path,
    iri,
    audienceGroups,
    draft,
    deprecated,
    staleAfter,
    checks = [],
    ...columns
  } = shelved;
  const title = columns.title ?? path;
  if (iri !== undefined) await seed.conceptIdentity({ workspaceId, iri });
  const row = await seed.conceptIndex({
    workspaceId,
    commitSha,
    path,
    ...(iri === undefined ? {} : { iri }),
    ...columns,
    title,
    frontmatter: {
      title,
      type: columns.conceptType ?? "Policy",
      ...(staleAfter === undefined ? {} : { stale_after: staleAfter }),
    },
    ...audienceOf(audienceGroups),
    ...draftOf(draft),
    ...deprecatedOf(deprecated),
  });
  for (const check of checks) {
    await seed.conceptVerification({
      workspaceId,
      iri: row.iri,
      actor: check.actor,
      verifiedAt: check.at,
      contentHash: row.contentHash,
    });
  }
  return ids.conceptIri.parse(row.iri);
};

export const shelve = (
  pool: pg.Pool,
  workspaceId: string,
  concepts: readonly Shelved[],
): Promise<readonly ConceptIri[]> =>
  seedingWith(pool, async (seed) => {
    const { sha } = await seed.bundleCommit({ workspaceId });
    const iris: ConceptIri[] = [];
    for (const shelved of concepts) {
      iris.push(await shelvedWith(seed, workspaceId, sha, shelved));
    }
    return iris;
  });

export const shelveOne = async (
  pool: pg.Pool,
  workspaceId: string,
  concept: Shelved,
): Promise<ConceptIri> => {
  const [iri] = await shelve(pool, workspaceId, [concept]);
  if (iri === undefined) throw new Error(`${concept.path} was not shelved`);
  return iri;
};

const WIDE_COLLECTIONS = 12;
const WIDE_CONCEPT_TYPES = 8;

export type WideKnowledge = {
  readonly count: number;
  readonly owners: readonly string[];
  readonly checker: string;
};

const wideConceptAt = (at: number, checker: string): Shelved => ({
  path: `knowledge/collection-${at % WIDE_COLLECTIONS}/concept-${at}.md`,
  title: `Concept ${String(at).padStart(5, "0")}`,
  conceptType: `Type ${at % WIDE_CONCEPT_TYPES}`,
  checks:
    at % 3 === 0
      ? [
          { actor: checker, at: new Date(Date.UTC(2026, 0, 1 + (at % 200))) },
          { actor: checker, at: new Date(Date.UTC(2026, 6, 1 + (at % 100))) },
        ]
      : [],
});

export const seedWideKnowledge = async (
  pool: pg.Pool,
  workspaceId: string,
  wide: WideKnowledge,
): Promise<readonly ConceptIri[]> => {
  const iris = await shelve(
    pool,
    workspaceId,
    Array.from({ length: wide.count }, (_unused, at) => wideConceptAt(at, wide.checker)),
  );
  await seedingWith(pool, async (seed) => {
    for (const [at, personId] of wide.owners.entries()) {
      for (let collection = at; collection < WIDE_COLLECTIONS; collection += wide.owners.length) {
        await seed.conceptOwner({ workspaceId, collection: `collection-${collection}`, personId });
      }
    }
    for (const [at, iri] of iris.filter((_iri, held) => held % 10 === 0).entries()) {
      const personId = wide.owners[at % wide.owners.length];
      if (personId !== undefined) await seed.conceptOwner({ workspaceId, iri, personId });
    }
  });
  await pool.query("ANALYZE concept_index, concept_owner, concept_verification");
  return iris;
};

export const joinedAs = async (
  db: MigratedPostgres,
  workspaceId: string,
  role: Role,
  options: { readonly name?: string; readonly group?: string } = {},
): Promise<UserPrincipal> => {
  const { name, group } = options;
  const person = await seedingWith(db.pool, async (seed) => {
    const user = await seed.user(name === undefined ? {} : { name });
    await seed.member({ workspaceId, userId: user.id, role });
    if (group !== undefined) {
      await seed.groupMember({ workspaceId, groupId: group, userId: user.id });
    }
    return user;
  });
  return principalFor(db, workspaceId, person.id);
};
