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
const RENAMED_TABLE_PREFIXES = ["llm_route", "graph"];

const NAMES_IN_PUBLIC = `
  SELECT 'constraint' AS kind, conname AS name FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace
  UNION ALL
  SELECT 'relation', relname FROM pg_class WHERE relnamespace = 'public'::regnamespace
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
});
