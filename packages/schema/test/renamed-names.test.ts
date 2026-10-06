import { beforeAll, describe, expect, it } from "vitest";

import type { MigratedPostgres } from "./harness.ts";
import { openMigratedPostgres } from "./warm-postgres.ts";

let db: MigratedPostgres;

beforeAll(async () => {
  db = await openMigratedPostgres();
  return async () => {
    await db.stop();
  };
});

/** A table rename leaves behind every name Postgres derived from the old one unless each is renamed too. */
const RENAMED_TABLE_PREFIXES = ["llm_route", "graph", "source_binding"];

/** Matched mid-name, as an index names its columns; index.chunk's binding_id sits outside public. */
const RENAMED_COLUMN_WORDS = ["binding"];

const NAMES_IN_PUBLIC = `
  SELECT 'constraint' AS kind, conname AS name FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace
  UNION ALL
  SELECT 'relation', relname FROM pg_class WHERE relnamespace = 'public'::regnamespace
  UNION ALL
  SELECT 'column', attname FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm')
      AND a.attnum > 0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'policy', polname FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    WHERE c.relnamespace = 'public'::regnamespace
  UNION ALL
  SELECT 'trigger', tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal
  UNION ALL
  SELECT 'function', proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace`;

describe("the names a renamed table leaves behind", () => {
  it("leaves no name in public under a renamed table's prefix", async () => {
    const { rows } = await db.pool.query<{ kind: string; name: string }>(NAMES_IN_PUBLIC);

    const left = rows.filter(({ name }) =>
      RENAMED_TABLE_PREFIXES.some((prefix) => name.startsWith(`${prefix}_`)),
    );

    expect(left).toEqual([]);
  });

  it("leaves no name in public holding a renamed column's word", async () => {
    const { rows } = await db.pool.query<{ kind: string; name: string }>(NAMES_IN_PUBLIC);

    const left = rows.filter(({ name }) =>
      RENAMED_COLUMN_WORDS.some((word) => name.includes(word)),
    );

    expect(left).toEqual([]);
  });
});
