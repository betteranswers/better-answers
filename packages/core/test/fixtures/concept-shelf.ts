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

export type Check = { readonly actor: string; readonly at: Date };

export type Shelved = {
  readonly path: string;
  readonly kind?: string;
  readonly title?: string;
  readonly sensitivity?: (typeof SENSITIVITIES)[number];
  readonly audienceGroups?: readonly string[];
  readonly draft?: true;

  /** Verifications of the concept as it stands, in the order they were made. */
  readonly checks?: readonly Check[];
};

const shelvedWith = async (
  seed: TestData,
  workspaceId: string,
  commitSha: string,
  shelved: Shelved,
): Promise<ConceptIri> => {
  const { path, audienceGroups, draft, checks = [], ...columns } = shelved;
  const title = columns.title ?? path;
  const row = await seed.conceptIndex({
    workspaceId,
    commitSha,
    path,
    ...columns,
    title,
    frontmatter: { title, type: columns.kind ?? "Policy" },
    ...(audienceGroups === undefined
      ? {}
      : { audience: AUDIENCE_GROUPS, audienceGroups: [...audienceGroups] }),
    ...(draft === undefined ? {} : { status: CONCEPT_DRAFT_STATUS, publishedAt: null }),
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

/** Puts concept rows straight into the index, with no git behind them. Returns their IRIs in order. */
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

export const joinedAs = async (
  db: MigratedPostgres,
  workspaceId: string,
  role: Role,
  name?: string,
): Promise<UserPrincipal> => {
  const person = await seedingWith(db.pool, async (seed) => {
    const user = await seed.user(name === undefined ? {} : { name });
    await seed.member({ workspaceId, userId: user.id, role });
    return user;
  });
  return principalFor(db, workspaceId, person.id);
};
