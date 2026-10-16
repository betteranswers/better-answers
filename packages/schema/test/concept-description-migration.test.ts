import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrationsFolder } from "../src/index.ts";
import { journalMetaFolder } from "../src/journal.ts";
import { POSTGRES_IMAGE } from "../src/postgres-image.ts";
import { testData } from "./factory.ts";
import { endPool, POSTGRES_COMMAND } from "./harness.ts";

const LAST_BEFORE = "0079_the-model-key";

const ROWS = 300;

const ONLY_IN_A_DESCRIPTION = "zebrafinch";

type Journal = { readonly entries: readonly { readonly tag: string }[] };

const folderEndingAt = (tag: string): string => {
  const journalText = readFileSync(path.join(journalMetaFolder, "_journal.json"), "utf8");
  // oxlint-disable-next-line typescript/consistent-type-assertions -- src/journal.ts owns the journal's schema; this copy only cuts its entries
  const journal = JSON.parse(journalText) as Journal & Record<string, unknown>;
  const entries = journal.entries.slice(0, journal.entries.findIndex((e) => e.tag === tag) + 1);
  if (entries.at(-1)?.tag !== tag) throw new Error(`${tag} is not in the journal`);
  const folder = mkdtempSync(path.join(tmpdir(), "until-0080-"));
  mkdirSync(path.join(folder, "meta"));
  writeFileSync(
    path.join(folder, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries }),
  );
  for (const entry of entries) {
    cpSync(path.join(migrationsFolder, `${entry.tag}.sql`), path.join(folder, `${entry.tag}.sql`));
  }
  return folder;
};

const standing = async (pool: pg.Pool) => {
  const read = await pool.query<{ rows: number; held: number; valid: boolean; ready: boolean }>(
    `SELECT (SELECT count(*)::int FROM concept_index) AS rows,
            (SELECT count(*)::int FROM concept_index
              WHERE search @@ to_tsquery('english', '${ONLY_IN_A_DESCRIPTION}')) AS held,
            i.indisvalid AS valid, i.indisready AS ready
       FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = 'concept_index_search_gin'`,
  );
  return read.rows[0];
};

describe("0080 over concepts stored before it", () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE)
      .withCommand([...POSTGRES_COMMAND])
      .start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 2 });
    await migrate(drizzle(pool), { migrationsFolder: folderEndingAt(LAST_BEFORE) });
    const client = await pool.connect();
    try {
      const seed = testData(client);
      const { id: workspaceId } = await seed.workspace();
      const { sha } = await seed.bundleCommit({ workspaceId });
      for (let at = 0; at < ROWS; at += 1) {
        const description =
          at === 0 ? `The ${ONLY_IN_A_DESCRIPTION} rule.` : `Kept for audit ${String(at)}.`;
        await seed.conceptIndex({
          workspaceId,
          commitSha: sha,
          title: `Answer ${String(at)}`,
          frontmatter: { title: `Answer ${String(at)}`, type: "Answer", description },
        });
      }
    } finally {
      client.release();
    }
  }, 300_000);

  afterAll(async () => {
    await endPool(pool);
    await container.stop();
  });

  it("keeps every row, indexes descriptions, leaves the index valid", async () => {
    const before = await standing(pool);

    await migrate(drizzle(pool), { migrationsFolder });

    expect({ before, after: await standing(pool) }).toEqual({
      before: { rows: ROWS, held: 0, valid: true, ready: true },
      after: { rows: ROWS, held: 1, valid: true, ready: true },
    });
  });
});
