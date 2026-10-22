import type pg from "pg";

import {
  AUDIENCE_EVERYONE,
  AUDIENCE_GROUPS,
  CONCEPT_IRI_PREFIX,
  CONCEPT_STABLE_STATUS,
  conceptIriOf,
  type SENSITIVITIES,
  ulid,
} from "../src/index.ts";

type IndexRows = {
  readonly workspaceId: string;
  readonly commitSha: string;
  readonly kind: string;
  readonly sensitivity: (typeof SENSITIVITIES)[number];
  readonly audienceGroups: readonly string[] | null;
  readonly concepts: readonly { readonly path: string; readonly title: string }[];
};

const BODY = "A concept held in the index alone, with no file behind it.";

const MINT_IDENTITIES = `INSERT INTO concept_identity (workspace_id, iri, merge_key)
  SELECT $1, iri, 'indexed:' || lower(substr(iri, ${CONCEPT_IRI_PREFIX.length + 1}))
    FROM unnest($2::text[]) AS held(iri)`;

const INDEX_ROWS = `INSERT INTO concept_index (workspace_id, iri, path, kind, title, frontmatter, body,
         content_hash, commit_sha, status, published_at, sensitivity, audience, audience_groups)
  SELECT $1, held.iri, held.path, $4, held.title,
         jsonb_build_object('title', held.title, 'type', $4::text), $5,
         encode(sha256(convert_to(held.path, 'UTF8')), 'hex'), $6, $7, now(), $8, $9, $10
    FROM unnest($2::text[], $3::text[], $11::text[]) AS held(iri, path, title)`;

/** One statement per table, where `testData`'s `conceptIndex` parses and writes a row at a time. */
export const conceptIndexRows = async (
  client: pg.PoolClient,
  rows: IndexRows,
): Promise<readonly string[]> => {
  const iris = rows.concepts.map(() => conceptIriOf(ulid()));
  await client.query(MINT_IDENTITIES, [rows.workspaceId, iris]);
  await client.query(INDEX_ROWS, [
    rows.workspaceId,
    iris,
    rows.concepts.map(({ path }) => path),
    rows.kind,
    BODY,
    rows.commitSha,
    CONCEPT_STABLE_STATUS,
    rows.sensitivity,
    rows.audienceGroups === null ? AUDIENCE_EVERYONE : AUDIENCE_GROUPS,
    rows.audienceGroups,
    rows.concepts.map(({ title }) => title),
  ]);
  return iris;
};
