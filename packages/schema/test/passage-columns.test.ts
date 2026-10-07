import type pg from "pg";
import { describe, expect, it } from "vitest";

import { EMBEDDING_DIMENSIONS, ulid } from "../src/index.ts";
import { passageWrittenThroughTheParent } from "./catalogue-statements.ts";
import { testData } from "./factory.ts";
import { withRollback } from "./harness.ts";
import { migrationStatementSaying } from "./journal-statements.ts";
import {
  ADMITTED,
  attemptPassageEmbeddedBy,
  passageWritingItsOwnFullText,
  postgresForSuite,
  refusalOf,
  refusesEach,
} from "./probes.ts";

const db = postgresForSuite();

const WS_A = "01J6EAAAAAAAAAAAAAAAAAAAAA";
const WS_B = "01J6EBBBBBBBBBBBBBBBBBBBBB";

type Attribute = { readonly column: string; readonly notNull: boolean; readonly generated: string };

const attributesOf = async (client: pg.PoolClient, relation: string): Promise<Attribute[]> => {
  const rows = await client.query(
    `SELECT a.attname AS column, a.attnotnull AS not_null, a.attgenerated AS generated
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'index' AND c.relname = $1 AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum`,
    [relation],
  );
  return rows.rows.map((row) => ({
    column: String(row.column),
    notNull: Boolean(row.not_null),
    generated: String(row.generated),
  }));
};

const indexShapeOf = async (
  client: pg.PoolClient,
  relation: string,
): Promise<{ fullText: boolean; vector: boolean }> => {
  const rows = await client.query(
    "SELECT indexdef FROM pg_indexes WHERE schemaname = 'index' AND tablename = $1",
    [relation],
  );
  const definitions = rows.rows.map((row) => String(row.indexdef)).join(" ");
  return {
    fullText: definitions.includes("USING gin (search)"),
    vector: definitions.includes("hnsw"),
  };
};

const seedOneDocument = async (client: pg.PoolClient, workspaceId: string) => {
  const seed = testData(client);
  await seed.workspace({ id: workspaceId, name: "A" });
  const connectedSource = await seed.connectedSource({ workspaceId });
  const document = await seed.sourceDocument({
    workspaceId,
    connectedSourceId: connectedSource.id,
  });
  return { seed, connectedSource, document };
};

const VECTOR = JSON.stringify(Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0));

const firstSpanOf = (documentId: string) => ({
  workspaceId: WS_A,
  sourceDocumentId: documentId,
  locator: "chars:0-40",
  ordinal: 0,
  charStart: 0,
  charEnd: 40,
});

describe("the passage's columns, on the parent and on a partition", () => {
  it("carries document, span and full text on a later partition", async () => {
    await withRollback(db().pool, async (client) => {
      const { seed } = await seedOneDocument(client, WS_A);
      await seed.passage({ workspaceId: WS_A });

      expect(await attributesOf(client, "passage")).toEqual([
        { column: "id", notNull: true, generated: "" },
        { column: "workspace_id", notNull: true, generated: "" },
        { column: "content", notNull: true, generated: "" },
        { column: "embedding", notNull: false, generated: "" },
        { column: "embedding_model_choice_id", notNull: false, generated: "" },
        { column: "connected_source_id", notNull: true, generated: "" },
        { column: "source_document_id", notNull: false, generated: "" },
        { column: "locator", notNull: false, generated: "" },
        { column: "ordinal", notNull: false, generated: "" },
        { column: "char_start", notNull: false, generated: "" },
        { column: "char_end", notNull: false, generated: "" },
        { column: "search", notNull: true, generated: "s" },
      ]);

      expect(await attributesOf(client, `passage_${WS_A}`)).toEqual(
        await attributesOf(client, "passage"),
      );
    });
  });

  it("propagates a parent ALTER to existing and later partitions", async () => {
    await withRollback(db().pool, async (client) => {
      const { seed } = await seedOneDocument(client, WS_A);
      await seed.passage({ workspaceId: WS_A });

      await client.query('ALTER TABLE "index".passage ADD COLUMN probe_note text');
      await client.query(
        `ALTER TABLE "index".passage ADD CONSTRAINT passage_probe_check
           CHECK (probe_note IS NULL OR length(probe_note) > 0)`,
      );
      await client.query(
        `ALTER TABLE "index".passage ADD COLUMN probe_search tsvector
           GENERATED ALWAYS AS (to_tsvector('english', content)) STORED`,
      );
      await client.query(
        'ALTER TABLE "index".passage ALTER COLUMN connected_source_id DROP NOT NULL',
      );

      await seed.workspace({ id: WS_B, name: "B" });
      const madeAfter = testData(client);
      await madeAfter.passage({ workspaceId: WS_B });

      const shapeOf = async (relation: string) => {
        const attributes = await attributesOf(client, relation);
        const constraint = await client.query(
          `SELECT 1 FROM pg_constraint co
             JOIN pg_class c ON c.oid = co.conrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'index' AND c.relname = $1 AND co.contype = 'c'
              AND co.conname LIKE '%probe%'`,
          [relation],
        );
        return {
          note: attributes.find((column) => column.column === "probe_note")?.generated,
          search: attributes.find((column) => column.column === "probe_search")?.generated,
          connectedSourceIdNotNull: attributes.find(
            (column) => column.column === "connected_source_id",
          )?.notNull,
          checks: constraint.rowCount,
        };
      };

      const propagated = { note: "", search: "s", connectedSourceIdNotNull: false, checks: 1 };
      expect({
        existing: await shapeOf(`passage_${WS_A}`),
        madeAfter: await shapeOf(`passage_${WS_B}`),
      }).toEqual({ existing: propagated, madeAfter: propagated });
    });
  });
});

describe("the embedding and the model choice it came from", () => {
  it("refuses a vector or model choice without the other", async () => {
    await withRollback(db().pool, async (client) => {
      const { seed } = await seedOneDocument(client, WS_A);
      await seed.passage({ workspaceId: WS_A });
      const connectedSource = `connected-source-${ulid()}`;

      const probe = (embedding: string | null, modelChoice: string | null) =>
        attemptPassageEmbeddedBy(client, WS_A, connectedSource, embedding, modelChoice);

      expect({
        vectorWithoutItsModelChoice: await probe(VECTOR, null),
        modelChoiceWithoutItsVector: await probe(null, "model-choice-embed"),
        neither: await probe(null, null),
        both: await probe(VECTOR, "model-choice-embed"),
      }).toEqual({
        vectorWithoutItsModelChoice: "passage_embedding_pair_check",
        modelChoiceWithoutItsVector: "passage_embedding_pair_check",
        neither: ADMITTED,
        both: ADMITTED,
      });
    });
  });
});

describe("the full-text column", () => {
  it("is computed by the database, refused to both runtime roles", async () => {
    await withRollback(db().pool, async (client) => {
      const { seed } = await seedOneDocument(client, WS_A);
      await seed.passage({ workspaceId: WS_A, content: "the handbook's holiday policy" });

      const computed = await client.query(
        `SELECT search @@ to_tsquery('english', 'holiday') AS matched FROM "index".passage`,
      );
      expect(computed.rows[0]?.matched).toBe(true);

      for (const role of ["app_rt", "worker_rt"]) {
        await client.query("RESET ROLE");
        await client.query(`SET LOCAL ROLE ${role}`);
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
        await refusesEach(client, [
          passageWritingItsOwnFullText(role, WS_A, `passage-${ulid()}`),
          [
            `UPDATE "index".passage SET search = to_tsvector('english', 'something else')`,
            `${role} rewriting the full text over content it did not change`,
            [],
            /can only be updated to DEFAULT/,
          ],
        ]);
      }
    });
  });
});

describe("a partition's indexes", () => {
  it("makes partitions through a definer that pins its search path", async () => {
    const read = await db().pool.query<{ definer: boolean; settings: string[] | null }>(
      `SELECT p.prosecdef AS definer, p.proconfig AS settings
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'create_workspace_partition'`,
    );

    expect(read.rows).toEqual([{ definer: true, settings: ["search_path=pg_catalog, pg_temp"] }]);
  });

  it("gives a new partition a full-text index, no vector index", async () => {
    await withRollback(db().pool, async (client) => {
      const { seed } = await seedOneDocument(client, WS_A);
      await seed.passage({ workspaceId: WS_A });

      expect(await indexShapeOf(client, `passage_${WS_A}`)).toEqual({
        fullText: true,
        vector: false,
      });
    });
  });

  it("gives an older partition the same pair through the migration", async () => {
    await withRollback(db().pool, async (client) => {
      await client.query(
        `CREATE TABLE "index"."passage_${WS_A}" PARTITION OF "index".passage FOR VALUES IN ('${WS_A}')`,
      );
      await client.query(
        `CREATE INDEX "passage_${WS_A}_embedding_hnsw" ON "index"."passage_${WS_A}"
           USING hnsw (embedding public.vector_cosine_ops)`,
      );

      const before = await indexShapeOf(client, `passage_${WS_A}`);
      await client.query(migrationStatementMatching("pg_inherits"));

      expect({ before, after: await indexShapeOf(client, `passage_${WS_A}`) }).toEqual({
        before: { fullText: false, vector: true },
        after: { fullText: true, vector: false },
      });
    });
  });
});

describe("the passage and the document it locates into", () => {
  it("goes with its document, leaving another document's passages standing", async () => {
    await withRollback(db().pool, async (client) => {
      const { seed, connectedSource, document } = await seedOneDocument(client, WS_A);
      const sibling = await seed.sourceDocument({
        workspaceId: WS_A,
        connectedSourceId: connectedSource.id,
      });
      await seed.passage(firstSpanOf(document.id));
      await seed.passage(firstSpanOf(sibling.id));

      await client.query("DELETE FROM source_document WHERE workspace_id = $1 AND id = $2", [
        WS_A,
        document.id,
      ]);

      const left = await client.query(
        'SELECT source_document_id FROM "index".passage ORDER BY source_document_id',
      );
      expect(left.rows).toEqual([{ source_document_id: sibling.id }]);
    });
  });

  it("refuses a second passage at the same document and locator", async () => {
    await withRollback(db().pool, async (client) => {
      const { seed, document } = await seedOneDocument(client, WS_A);
      await seed.passage(firstSpanOf(document.id));

      const second = await refusalOf(client, () => seed.passage(firstSpanOf(document.id)));
      const onTheParent = await client.query(
        `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'index' AND c.relname = $1`,
        ["passage_workspace_id_source_document_id_locator_uidx"],
      );

      expect({ refusedBy: second, declaredOnTheParent: onTheParent.rowCount }).toEqual({
        refusedBy: `passage_${WS_A}_locator_uidx`,
        declaredOnTheParent: 1,
      });
    });
  });
});

describe("the worker on the passage index", () => {
  it("writes passages through the parent and is refused the partition", async () => {
    await withRollback(db().pool, async (client) => {
      const { seed, document } = await seedOneDocument(client, WS_A);
      await seed.passage({ workspaceId: WS_A });

      await client.query("SET LOCAL ROLE worker_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      const id = await passageWrittenThroughTheParent(client, WS_A, document.id);
      await client.query(
        `UPDATE "index".passage SET content = 'the paragraph again' WHERE workspace_id = $1 AND id = $2`,
        [WS_A, id],
      );
      const rewritten = await client.query(`SELECT content FROM "index".passage WHERE id = $1`, [
        id,
      ]);
      await client.query(`DELETE FROM "index".passage WHERE workspace_id = $1 AND id = $2`, [
        WS_A,
        id,
      ]);
      const afterDelete = await client.query(`SELECT id FROM "index".passage WHERE id = $1`, [id]);
      expect({ rewritten: rewritten.rows, left: afterDelete.rows }).toEqual({
        rewritten: [{ content: "the paragraph again" }],
        left: [],
      });

      await refusesEach(client, [
        [
          `SELECT id FROM "index"."passage_${WS_A}"`,
          "the worker reaches passage rows through the policied parent, never through a partition",
        ],
      ]);
    });
  });
});

/** Migration 0037 names the table as it stood then; migration 0069 renamed it. */
const migrationStatementMatching = (word: string): string =>
  migrationStatementSaying("the-chunk-substrate.sql", word).replace(
    "parent.relname = 'chunk'",
    "parent.relname = 'passage'",
  );
