import type pg from "pg";

import { ulid } from "../../src/index.ts";
import type { TestData } from "../support/factory.ts";

/** The factory writes today's column names, so these rows are written as 0100 names them. */
export const THE_LAST_BEFORE_0101 = "0100_the-concept-kind";

export type ConceptBefore0101 = {
  readonly conceptType: string;
  readonly title: string;
  readonly frontmatter: Readonly<Record<string, string>>;
};

const CONCEPT_BEFORE_0101 = `INSERT INTO concept_index
    (workspace_id, iri, path, kind, title, frontmatter, body, content_hash, commit_sha, status,
     published_at, sensitivity, audience)
  VALUES ($1, $2, $3, $4, $5, $6, 'Expenses are claimed within thirty days.',
          encode(sha256(convert_to($3, 'UTF8')), 'hex'), $7, 'stable', now(), 'Internal',
          'everyone')`;

export const conceptStoredBefore0101 = async (
  seed: TestData,
  client: pg.PoolClient,
  workspaceId: string,
  commitSha: string,
  row: ConceptBefore0101,
): Promise<void> => {
  const { iri } = await seed.conceptIdentity({ workspaceId });
  await client.query(CONCEPT_BEFORE_0101, [
    workspaceId,
    iri,
    `knowledge/${iri.slice(-26).toLowerCase()}.md`,
    row.conceptType,
    row.title,
    row.frontmatter,
    commitSha,
  ]);
};

export type TypesBefore0101 = {
  readonly workspaceId: string;
  readonly iri: string;
  readonly sha: string;
  readonly product: string;
  readonly guideId: string;
  readonly suggestionId: string;
};

const statementsBefore0101 = ({
  workspaceId,
  iri,
  sha,
  product,
  guideId,
  suggestionId,
}: TypesBefore0101) =>
  [
    [
      `INSERT INTO concept_index (workspace_id, iri, path, kind, title, frontmatter, body,
                                  content_hash, commit_sha, status, published_at, sensitivity,
                                  audience)
       VALUES ($1, $2, 'knowledge/expenses.md', 'Policy', 'Expenses',
               '{"title": "Expenses", "type": "Policy"}', 'Expenses are claimed within thirty days.',
               repeat('a', 64), $3, 'stable', now(), 'Internal', 'everyone')`,
      [workspaceId, iri, sha],
    ],
    [
      `INSERT INTO map_node (workspace_id, gen, uid, label, kind, published_at, sensitivity, audience)
       VALUES ($1, 1, $2, 'Concept', 'Policy', now(), 'Internal', 'everyone'),
              ($1, 1, $3, 'Concept', 'Product', now(), 'Internal', 'everyone')`,
      [workspaceId, iri, product],
    ],
    [
      `INSERT INTO map_edge (workspace_id, gen, uid, label, from_uid, to_uid, from_kind, to_kind,
                             section, sentence, published_at, sensitivity, audience)
       VALUES ($1, 1, $4, 'LINKS_TO', $2, $3, 'Policy', 'Product', 'Details',
               'Expenses rest on the product.', now(), 'Internal', 'everyone')`,
      [workspaceId, iri, product, `links_to:${iri}:0`],
    ],
    [
      `INSERT INTO guide_definition (workspace_id, id, template, kind, collection)
       VALUES ($1, $2, 'bid-library', 'Bid library', 'company')`,
      [workspaceId, guideId],
    ],
    [
      `INSERT INTO guide_section (workspace_id, guide_id, id, ordinal, prompt, role_label, layers)
       VALUES ($1, $2, 's1', 0, 'Insurance', 'know', ARRAY['assembled'])`,
      [workspaceId, guideId],
    ],
    [
      `INSERT INTO guide_expected_fact (workspace_id, id, guide_id, section_id, ordinal, name, kind)
       VALUES ($1, 'f1', $2, 's1', 0, 'Employers liability', 'Insurance policy')`,
      [workspaceId, guideId],
    ],
    [
      `INSERT INTO suggestion (workspace_id, id, set_id, kind, proposer)
       VALUES ($1, $2, $3, 'edit', 'human:01J6CCCCCCCCCCCCCCCCCCCCCC')`,
      [workspaceId, suggestionId, ulid()],
    ],
    [
      `INSERT INTO concept_write_request (workspace_id, suggestion_id, merge_key, path,
                                          concept_kind, title, frontmatter, body)
       VALUES ($1, $2, 'policy:expenses', 'knowledge/expenses.md', 'Policy', 'Expenses',
               '{"title": "Expenses"}', 'Expenses are claimed within fourteen days.')`,
      [workspaceId, suggestionId],
    ],
  ] as const;

export const typesStoredBefore0101 = async (
  client: pg.PoolClient,
  stored: TypesBefore0101,
): Promise<void> => {
  for (const [statement, values] of statementsBefore0101(stored)) {
    await client.query(statement, [...values]);
  }
};
