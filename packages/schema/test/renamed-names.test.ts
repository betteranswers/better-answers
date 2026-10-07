import type pg from "pg";
import { describe, expect, it } from "vitest";

import { testData } from "./factory.ts";
import { withRollback } from "./harness.ts";
import { postgresForSuite } from "./probes.ts";

const db = postgresForSuite();

/** A table rename leaves behind every name Postgres derived from the old one unless each is renamed too. */
const RENAMED_TABLE_PREFIXES = [
  "llm_route",
  "graph",
  "source_binding",
  "composition",
  "concept_class_override",
];

/** Matched mid-name, as an index names its columns and a partition its parent. */
const RENAMED_WORDS = [
  "binding",
  "candidate",
  "checked",
  "chunk",
  "class_override",
  "composition",
  "quarantin",
  "repair",
  "route",
  "slug",
  "narrower_class",
];

const NAMES = `
  SELECT 'constraint' AS kind, conname AS name FROM pg_constraint
    WHERE connamespace = ANY ($1::regnamespace[])
  UNION ALL
  SELECT 'relation', relname FROM pg_class WHERE relnamespace = ANY ($1::regnamespace[])
  UNION ALL
  SELECT 'column', attname FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    WHERE c.relnamespace = ANY ($1::regnamespace[]) AND c.relkind IN ('r', 'p', 'v', 'm')
      AND a.attnum > 0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'policy', polname FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    WHERE c.relnamespace = ANY ($1::regnamespace[])
  UNION ALL
  SELECT 'trigger', tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relnamespace = ANY ($1::regnamespace[]) AND NOT t.tgisinternal
  UNION ALL
  SELECT 'function', proname FROM pg_proc WHERE pronamespace = ANY ($1::regnamespace[])`;

const WORKSPACE = "01J6EAAAAAAAAAAAAAAAAAAAAA";

/** A workspace's partition, its indexes and its constraints are named only once one is made. */
const namesWithAPartition = async (client: pg.PoolClient) => {
  const seed = testData(client);
  await seed.workspace({ id: WORKSPACE, name: "A" });
  await seed.passage({ workspaceId: WORKSPACE });
  const { rows } = await client.query<{ kind: string; name: string }>(NAMES, [["public", "index"]]);
  return rows;
};

describe("the names a renamed table leaves behind", () => {
  it("leaves no name under a renamed table's prefix", async () => {
    await withRollback(db().pool, async (client) => {
      const rows = await namesWithAPartition(client);

      const left = rows.filter(({ name }) =>
        RENAMED_TABLE_PREFIXES.some((prefix) => name.startsWith(`${prefix}_`)),
      );

      expect(left).toEqual([]);
    });
  });

  it("leaves no name holding a renamed word", async () => {
    await withRollback(db().pool, async (client) => {
      const rows = await namesWithAPartition(client);

      const left = rows.filter(({ name }) => RENAMED_WORDS.some((word) => name.includes(word)));

      expect(left).toEqual([]);
    });
  });
});
