import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type pg from "pg";
import { describe, expect, it } from "vitest";

import { migrationsFolder } from "../../src/index.ts";
import { testData } from "../support/factory.ts";
import { conceptStoredBefore0101, type ConceptBefore0101 } from "./before-the-concept-type.ts";
import { inADatabaseMigratedTo } from "./database-at.ts";

const ROWS = 300;

/** The english configuration leaves it unstemmed, so the query and the stored lexeme agree. */
const ONE_ROWS_WORD = "zebrafinch";

const title = (at: number) => `Answer ${String(at)}`;

const MIGRATIONS: readonly {
  readonly migration: string;
  readonly lastBefore: string;
  readonly rowAt: (at: number) => ConceptBefore0101;
}[] = [
  {
    migration: "0080 adds descriptions",
    lastBefore: "0079_the-model-key",
    rowAt: (at) => ({
      conceptType: "Answer",
      title: title(at),
      frontmatter: {
        title: title(at),
        type: "Answer",
        description: at === 0 ? `The ${ONE_ROWS_WORD} rule.` : `Kept for audit ${String(at)}.`,
      },
    }),
  },
  {
    migration: "0100 adds kinds",
    lastBefore: "0099_the-lineage-rebuilds",
    rowAt: (at) => {
      const conceptType = at === 0 ? `${ONE_ROWS_WORD} Policy` : "Policy";
      return {
        conceptType,
        title: title(at),
        frontmatter: { title: title(at), type: conceptType },
      };
    },
  },
];

const standing = async (pool: pg.Pool) => {
  const read = await pool.query<{
    rows: number;
    held: number;
    weights: string | null;
    valid: boolean;
    ready: boolean;
  }>(
    `SELECT (SELECT count(*)::int FROM concept_index) AS rows,
            (SELECT count(*)::int FROM concept_index
              WHERE search @@ to_tsquery('english', $1)) AS held,
            (SELECT string_agg(array_to_string(held.weights, ''), '')
               FROM concept_index, unnest(search) AS held WHERE held.lexeme = $1) AS weights,
            i.indisvalid AS valid, i.indisready AS ready
       FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = 'concept_index_search_gin'`,
    [ONE_ROWS_WORD],
  );
  return read.rows[0];
};

describe("a search vector migration over concepts stored before it", () => {
  it.each(MIGRATIONS)(
    "$migration at B and keeps a valid index",
    async ({ lastBefore, rowAt }) => {
      await inADatabaseMigratedTo(lastBefore, async (pool) => {
        const client = await pool.connect();
        try {
          const seed = testData(client);
          const { id: workspaceId } = await seed.workspace();
          const { sha } = await seed.bundleCommit({ workspaceId });
          for (let at = 0; at < ROWS; at += 1) {
            await conceptStoredBefore0101(seed, client, workspaceId, sha, rowAt(at));
          }
        } finally {
          client.release();
        }
        const before = await standing(pool);

        await migrate(drizzle(pool), { migrationsFolder });

        expect({ before, after: await standing(pool) }).toEqual({
          before: { rows: ROWS, held: 0, weights: null, valid: true, ready: true },
          after: { rows: ROWS, held: 1, weights: "B", valid: true, ready: true },
        });
      });
    },
    300_000,
  );
});
