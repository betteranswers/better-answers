import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { testData } from "./factory.ts";
import type { MigratedPostgres } from "./harness.ts";
import { openMigratedPostgres } from "./warm-postgres.ts";

/**
 * PROBE — THROWAWAY (T-113, probe 1 of 4; route spec, Further Notes). Never merged.
 *
 * Two claims the architecture review reasoned from Postgres's rules and never ran:
 *
 *   (a) a **stored generated `tsvector`** over `concept_index`'s `title`, `body` and the
 *       `frontmatter`-held tags through `jsonb_path_query_array(frontmatter, '$.tags[*]')::text`
 *       is accepted as IMMUTABLE on the pinned Postgres 18 image (write-path F5);
 *   (b) **`DROP NOT NULL` on `index.chunk`'s LIST-partitioned parent propagates** to the
 *       partitions that exist and to one created afterwards through the lifecycle function,
 *       and the pairing CHECK rides with it (record-families F3).
 *
 * A third, S1's own: a generated `tsvector` and a per-partition GIN index on the chunk
 * parent, since S1's spec says the chunk's full-text vector is a generated column too.
 */

const FTS = `
  setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A')
  || setweight(to_tsvector('english'::regconfig, coalesce(jsonb_path_query_array(frontmatter, '$.tags[*]')::text, '')), 'B')
  || setweight(to_tsvector('english'::regconfig, coalesce(jsonb_path_query_array(frontmatter, '$."also known as"[*]')::text, '')), 'B')
  || setweight(to_tsvector('english'::regconfig, coalesce(body, '')), 'C')`;

let db: MigratedPostgres;

beforeAll(async () => {
  db = await openMigratedPostgres();
});

afterAll(async () => {
  await db.stop();
});

const attribute = async (relation: string, column: string) => {
  const found = await db.pool.query<{ attnotnull: boolean; attgenerated: string }>(
    `SELECT a.attnotnull, a.attgenerated
       FROM pg_attribute a
      WHERE a.attrelid = $1::regclass AND a.attname = $2`,
    [relation, column],
  );
  return found.rows[0];
};

const constraintsOn = async (relation: string) => {
  const found = await db.pool.query<{ conname: string; contype: string; def: string }>(
    `SELECT conname, contype, pg_get_constraintdef(oid) AS def
       FROM pg_constraint WHERE conrelid = $1::regclass ORDER BY conname`,
    [relation],
  );
  return found.rows;
};

const indexesOn = async (relation: string) => {
  const found = await db.pool.query<{ indexname: string; indexdef: string }>(
    `SELECT c.relname AS indexname, pg_get_indexdef(i.indexrelid) AS indexdef
       FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE i.indrelid = $1::regclass ORDER BY 1`,
    [relation],
  );
  return found.rows;
};

describe("probe 1(a): the stored generated tsvector on concept_index", () => {
  it("is accepted as a STORED generated column, indexed by GIN, and matches a tag held in frontmatter", async () => {
    const version = await db.pool.query<{ v: string }>("SELECT version() AS v");
    console.log("[probe-1] server:", version.rows[0]?.v);

    await db.pool.query(
      `ALTER TABLE concept_index ADD COLUMN search tsvector GENERATED ALWAYS AS (${FTS}) STORED`,
    );
    await db.pool.query(
      "CREATE INDEX concept_index_search_gin ON concept_index USING gin (search)",
    );

    expect(await attribute("concept_index", "search")).toEqual({
      attnotnull: false,
      attgenerated: "s",
    });

    const client = await db.pool.connect();
    let workspaceId: string;
    try {
      const seed = testData(client);
      const workspace = await seed.workspace();
      workspaceId = workspace.id;
      await seed.conceptIndex({
        workspaceId,
        title: "Expenses policy",
        body: "Expenses are claimed within thirty days. See `code_span_token` and https://example.test/receipts.",
        frontmatter: {
          title: "Expenses policy",
          type: "Policy",
          tags: ["reimbursement", "travel-costs"],
          "also known as": ["expense claims"],
        },
      });
      await seed.conceptIndex({
        workspaceId,
        title: "Holiday policy",
        body: "Annual leave is booked a fortnight ahead.",
        frontmatter: { title: "Holiday policy", type: "Policy", tags: ["leave"] },
      });
      await seed.conceptIndex({
        workspaceId,
        title: "Untagged",
        body: "No tags key at all.",
        frontmatter: { title: "Untagged", type: "Note" },
      });
    } finally {
      client.release();
    }

    const stored = await db.pool.query<{ title: string; search: string }>(
      "SELECT title, search::text AS search FROM concept_index WHERE workspace_id = $1 ORDER BY title",
      [workspaceId],
    );
    console.log("[probe-1] stored vectors:", JSON.stringify(stored.rows, null, 2));

    const query = (q: string) =>
      db.pool.query<{ title: string; rank: number }>(
        `SELECT title, ts_rank(search, websearch_to_tsquery('english', $2))::float AS rank
           FROM concept_index WHERE workspace_id = $1 AND search @@ websearch_to_tsquery('english', $2)
          ORDER BY rank DESC`,
        [workspaceId, q],
      );
    const byTag = await query("reimbursement");
    const byAka = await query("expense claims");
    const byTitle = await query("holiday");
    const byBody = await query("fortnight");
    const byCodeSpan = await query("code_span_token");
    const byUrl = await query("example.test/receipts");
    console.log("[probe-1] matches:", {
      byTag: byTag.rows,
      byAka: byAka.rows,
      byTitle: byTitle.rows,
      byBody: byBody.rows,
      byCodeSpan: byCodeSpan.rows,
      byUrl: byUrl.rows,
    });
    expect(byTag.rows.map((r) => r.title)).toEqual(["Expenses policy"]);
    expect(byAka.rows.map((r) => r.title)).toEqual(["Expenses policy"]);
    expect(byTitle.rows.map((r) => r.title)).toEqual(["Holiday policy"]);
    expect(byBody.rows.map((r) => r.title)).toEqual(["Holiday policy"]);

    // The planner reaches the GIN index for the predicate (seq scan is off to force the point).
    await db.pool.query("SET enable_seqscan = off");
    const plan = await db.pool.query<{ "QUERY PLAN": string }>(
      `EXPLAIN SELECT title FROM concept_index WHERE workspace_id = $1 AND search @@ websearch_to_tsquery('english', 'reimbursement')`,
      [workspaceId],
    );
    await db.pool.query("RESET enable_seqscan");
    const planText = plan.rows.map((r) => r["QUERY PLAN"]).join("\n");
    console.log("[probe-1] plan (3 rows, workspace filter wins):\n" + planText);
    await db.pool.query("SET enable_seqscan = off");
    const planFts = await db.pool.query<{ "QUERY PLAN": string }>(
      `EXPLAIN SELECT title FROM concept_index WHERE search @@ websearch_to_tsquery('english', 'reimbursement')`,
    );
    await db.pool.query("RESET enable_seqscan");
    const planFtsText = planFts.rows.map((r) => r["QUERY PLAN"]).join("\n");
    console.log("[probe-1] plan (predicate alone):\n" + planFtsText);
    expect(planFtsText).toContain("concept_index_search_gin");
  });
});

describe("probe 1(b): DROP NOT NULL on the LIST-partitioned index.chunk parent", () => {
  it("propagates to an existing partition and to one created afterwards, with the pairing CHECK", async () => {
    const client = await db.pool.connect();
    let before: string;
    let after: string;
    try {
      // In one transaction: the lifecycle function reads the transaction-local scope the
      // factory sets before calling it.
      await client.query("BEGIN");
      const seed = testData(client);
      // An existing partition, created the way the app creates one (through the seed's call
      // to the lifecycle function) *before* the ALTER.
      const chunk = await seed.chunk();
      before = chunk.workspaceId;
      // A workspace whose partition will be created *after* the ALTER.
      after = (await seed.workspace()).id;
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const partitionOf = (ws: string) => `"index"."chunk_${ws}"`;

    expect((await attribute(partitionOf(before), "embedding"))?.attnotnull).toBe(true);
    expect((await attribute(partitionOf(before), "embedding_route_id"))?.attnotnull).toBe(true);

    await db.pool.query(`
      ALTER TABLE "index".chunk
        ALTER COLUMN embedding DROP NOT NULL,
        ALTER COLUMN embedding_route_id DROP NOT NULL,
        ADD CONSTRAINT chunk_embedding_pair_check
          CHECK ((embedding IS NULL) = (embedding_route_id IS NULL))`);

    // S1's own line: the chunk's full-text vector as a generated column on the parent.
    await db.pool.query(`
      ALTER TABLE "index".chunk
        ADD COLUMN search tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, content)) STORED`);

    // Existing partition: nullable now, CHECK present, generated column present.
    expect((await attribute(partitionOf(before), "embedding"))?.attnotnull).toBe(false);
    expect((await attribute(partitionOf(before), "embedding_route_id"))?.attnotnull).toBe(false);
    expect((await attribute(partitionOf(before), "search"))?.attgenerated).toBe("s");
    const beforeConstraints = await constraintsOn(partitionOf(before));
    console.log("[probe-1b] existing partition constraints:", beforeConstraints);
    expect(beforeConstraints.map((c) => c.conname)).toContain("chunk_embedding_pair_check");

    // A partition created after the ALTER, through the lifecycle function the app calls.
    const scoped = await db.pool.connect();
    try {
      await scoped.query("BEGIN");
      await scoped.query("SELECT set_config('app.workspace_id', $1, true)", [after]);
      await scoped.query("SELECT create_workspace_partition($1)", [after]);
      await scoped.query("COMMIT");
    } finally {
      scoped.release();
    }
    expect((await attribute(partitionOf(after), "embedding"))?.attnotnull).toBe(false);
    expect((await attribute(partitionOf(after), "embedding_route_id"))?.attnotnull).toBe(false);
    expect((await attribute(partitionOf(after), "search"))?.attgenerated).toBe("s");
    const afterConstraints = await constraintsOn(partitionOf(after));
    expect(afterConstraints.map((c) => c.conname)).toContain("chunk_embedding_pair_check");

    // A per-partition GIN index on the generated column, beside the HNSW the function makes.
    await db.pool.query(
      `CREATE INDEX "chunk_${after}_search_gin" ON ${partitionOf(after)} USING gin (search)`,
    );
    console.log("[probe-1b] new partition indexes:", await indexesOn(partitionOf(after)));

    // Both NULL: accepted. One NULL: refused by the named CHECK.
    const insert = (embedding: string | null, route: string | null) =>
      db.pool.query(
        `INSERT INTO "index".chunk (id, workspace_id, content, embedding, embedding_route_id, sensitivity, audience, audience_groups, binding_id)
         VALUES ($1, $2, 'a passage about receipts', $3, $4, 'Internal', 'everyone', NULL, 'binding-probe')`,
        [`chunk-${Math.random().toString(36).slice(2)}`, after, embedding, route],
      );
    await expect(insert(null, null)).resolves.toBeDefined();
    const half = await insert(null, "route-1").then(
      () => "accepted",
      (error: unknown) => (error as { constraint?: string }).constraint ?? String(error),
    );
    console.log("[probe-1b] half-written pair:", half);
    expect(half).toBe("chunk_embedding_pair_check");

    const hit = await db.pool.query<{ id: string }>(
      `SELECT id FROM "index".chunk WHERE workspace_id = $1 AND search @@ plainto_tsquery('english', 'receipts')`,
      [after],
    );
    expect(hit.rowCount).toBe(1);
  });
});
