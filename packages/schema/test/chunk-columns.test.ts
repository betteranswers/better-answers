import type pg from "pg";
import { describe, expect, it } from "vitest";

import { EMBEDDING_DIMENSIONS, ulid } from "../src/index.ts";
import { chunkWrittenThroughTheParent } from "./catalogue-statements.ts";
import { testData } from "./factory.ts";
import { withRollback } from "./harness.ts";
import { migrationStatementSaying } from "./journal-statements.ts";
import {
  ADMITTED,
  attemptChunkEmbeddedBy,
  chunkWritingItsOwnFullText,
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
  const binding = await seed.sourceBinding({ workspaceId });
  const document = await seed.sourceDocument({ workspaceId, bindingId: binding.id });
  return { seed, binding, document };
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

describe("the chunk's columns, on the parent and on a partition", () => {
  it("carries document, span and full text on a later partition", async () => {
    await withRollback(db().pool, async (client) => {
      const { seed } = await seedOneDocument(client, WS_A);
      await seed.chunk({ workspaceId: WS_A });

      expect(await attributesOf(client, "chunk")).toEqual([
        { column: "id", notNull: true, generated: "" },
        { column: "workspace_id", notNull: true, generated: "" },
        { column: "content", notNull: true, generated: "" },
        { column: "embedding", notNull: false, generated: "" },
        { column: "embedding_route_id", notNull: false, generated: "" },
        { column: "binding_id", notNull: true, generated: "" },
        { column: "source_document_id", notNull: false, generated: "" },
        { column: "locator", notNull: false, generated: "" },
        { column: "ordinal", notNull: false, generated: "" },
        { column: "char_start", notNull: false, generated: "" },
        { column: "char_end", notNull: false, generated: "" },
        { column: "search", notNull: true, generated: "s" },
      ]);

      expect(await attributesOf(client, `chunk_${WS_A}`)).toEqual(
        await attributesOf(client, "chunk"),
      );
    });
  });

  it("propagates a parent ALTER to existing and later partitions", async () => {
    await withRollback(db().pool, async (client) => {
      const { seed } = await seedOneDocument(client, WS_A);
      await seed.chunk({ workspaceId: WS_A });

      await client.query('ALTER TABLE "index".chunk ADD COLUMN probe_note text');
      await client.query(
        `ALTER TABLE "index".chunk ADD CONSTRAINT chunk_probe_check
           CHECK (probe_note IS NULL OR length(probe_note) > 0)`,
      );
      await client.query(
        `ALTER TABLE "index".chunk ADD COLUMN probe_search tsvector
           GENERATED ALWAYS AS (to_tsvector('english', content)) STORED`,
      );
      await client.query('ALTER TABLE "index".chunk ALTER COLUMN binding_id DROP NOT NULL');

      await seed.workspace({ id: WS_B, name: "B" });
      const madeAfter = testData(client);
      await madeAfter.chunk({ workspaceId: WS_B });

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
          bindingIdNotNull: attributes.find((column) => column.column === "binding_id")?.notNull,
          checks: constraint.rowCount,
        };
      };

      const propagated = { note: "", search: "s", bindingIdNotNull: false, checks: 1 };
      expect({
        existing: await shapeOf(`chunk_${WS_A}`),
        madeAfter: await shapeOf(`chunk_${WS_B}`),
      }).toEqual({ existing: propagated, madeAfter: propagated });
    });
  });
});

describe("the embedding and the route it came from", () => {
  it("refuses a vector or route alone, admitting neither or both", async () => {
    await withRollback(db().pool, async (client) => {
      const { seed } = await seedOneDocument(client, WS_A);
      await seed.chunk({ workspaceId: WS_A });
      const binding = `binding-${ulid()}`;

      const probe = (embedding: string | null, route: string | null) =>
        attemptChunkEmbeddedBy(client, WS_A, binding, embedding, route);

      expect({
        vectorWithoutItsRoute: await probe(VECTOR, null),
        routeWithoutItsVector: await probe(null, "route-embed"),
        neither: await probe(null, null),
        both: await probe(VECTOR, "route-embed"),
      }).toEqual({
        vectorWithoutItsRoute: "chunk_embedding_pair_check",
        routeWithoutItsVector: "chunk_embedding_pair_check",
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
      await seed.chunk({ workspaceId: WS_A, content: "the handbook's holiday policy" });

      const computed = await client.query(
        `SELECT search @@ to_tsquery('english', 'holiday') AS matched FROM "index".chunk`,
      );
      expect(computed.rows[0]?.matched).toBe(true);

      for (const role of ["app_rt", "worker_rt"]) {
        await client.query("RESET ROLE");
        await client.query(`SET LOCAL ROLE ${role}`);
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
        await refusesEach(client, [
          chunkWritingItsOwnFullText(role, WS_A, `chunk-${ulid()}`),
          [
            `UPDATE "index".chunk SET search = to_tsvector('english', 'something else')`,
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
  it("gives a new partition a full-text index, no vector index", async () => {
    await withRollback(db().pool, async (client) => {
      const { seed } = await seedOneDocument(client, WS_A);
      await seed.chunk({ workspaceId: WS_A });

      expect(await indexShapeOf(client, `chunk_${WS_A}`)).toEqual({
        fullText: true,
        vector: false,
      });
    });
  });

  it("gives an older partition the same pair through the migration", async () => {
    await withRollback(db().pool, async (client) => {
      await client.query(
        `CREATE TABLE "index"."chunk_${WS_A}" PARTITION OF "index".chunk FOR VALUES IN ('${WS_A}')`,
      );
      await client.query(
        `CREATE INDEX "chunk_${WS_A}_embedding_hnsw" ON "index"."chunk_${WS_A}"
           USING hnsw (embedding public.vector_cosine_ops)`,
      );

      const before = await indexShapeOf(client, `chunk_${WS_A}`);
      await client.query(migrationStatementMatching("pg_inherits"));

      expect({ before, after: await indexShapeOf(client, `chunk_${WS_A}`) }).toEqual({
        before: { fullText: false, vector: true },
        after: { fullText: true, vector: false },
      });
    });
  });
});

describe("the chunk and the document it locates into", () => {
  it("goes with its document, leaving another document's chunks standing", async () => {
    await withRollback(db().pool, async (client) => {
      const { seed, binding, document } = await seedOneDocument(client, WS_A);
      const sibling = await seed.sourceDocument({ workspaceId: WS_A, bindingId: binding.id });
      await seed.chunk(firstSpanOf(document.id));
      await seed.chunk(firstSpanOf(sibling.id));

      await client.query("DELETE FROM source_document WHERE workspace_id = $1 AND id = $2", [
        WS_A,
        document.id,
      ]);

      const left = await client.query(
        'SELECT source_document_id FROM "index".chunk ORDER BY source_document_id',
      );
      expect(left.rows).toEqual([{ source_document_id: sibling.id }]);
    });
  });

  it("refuses a second chunk at the same document and locator", async () => {
    await withRollback(db().pool, async (client) => {
      const { seed, document } = await seedOneDocument(client, WS_A);
      await seed.chunk(firstSpanOf(document.id));

      const second = await refusalOf(client, () => seed.chunk(firstSpanOf(document.id)));
      const onTheParent = await client.query(
        `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'index' AND c.relname = $1`,
        ["chunk_workspace_id_source_document_id_locator_uidx"],
      );

      expect({ refusedBy: second, declaredOnTheParent: onTheParent.rowCount }).toEqual({
        refusedBy: "chunk_01J6EAAAAAAAAAAAAAAAAAA_workspace_id_source_document__idx",
        declaredOnTheParent: 1,
      });
    });
  });
});

describe("the worker on the chunk index", () => {
  it("writes chunks through the parent and is refused the partition", async () => {
    await withRollback(db().pool, async (client) => {
      const { seed, document } = await seedOneDocument(client, WS_A);
      await seed.chunk({ workspaceId: WS_A });

      await client.query("SET LOCAL ROLE worker_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      const id = await chunkWrittenThroughTheParent(client, WS_A, document.id);
      await client.query(
        `UPDATE "index".chunk SET content = 'the paragraph again' WHERE workspace_id = $1 AND id = $2`,
        [WS_A, id],
      );
      const rewritten = await client.query(`SELECT content FROM "index".chunk WHERE id = $1`, [id]);
      await client.query(`DELETE FROM "index".chunk WHERE workspace_id = $1 AND id = $2`, [
        WS_A,
        id,
      ]);
      const afterDelete = await client.query(`SELECT id FROM "index".chunk WHERE id = $1`, [id]);
      expect({ rewritten: rewritten.rows, left: afterDelete.rows }).toEqual({
        rewritten: [{ content: "the paragraph again" }],
        left: [],
      });

      await refusesEach(client, [
        [
          `SELECT id FROM "index"."chunk_${WS_A}"`,
          "the worker reaches chunk rows through the policied parent, never through a partition",
        ],
      ]);
    });
  });
});

const migrationStatementMatching = (word: string): string =>
  migrationStatementSaying("the-chunk-substrate.sql", word);
