import { readFileSync } from "node:fs";
import type pg from "pg";
import { describe, expect, it } from "vitest";

import { EMBEDDING_DIMENSIONS, ulid } from "../src/index.ts";
import { journalMigrationFiles } from "../src/journal.ts";
import { testData } from "./factory.ts";
import { withRollback } from "./harness.ts";
import { ADMITTED, postgresForSuite, refusalOf, refusesEach } from "./probes.ts";

/**
 * The **chunk index** as the database holds it after S1's substrate migration (the S1 spec,
 * *The schema* and *The chunk's identity and the locator*): a row that carries the document it
 * came from and the span it covers, that may carry no vector at all, and whose full-text
 * column is the database's own work and neither tier's.
 *
 * Every probe is plain SQL aimed at the table, for the reason `source-catalogue.test.ts` gives:
 * the row is the subject under test, both tiers write these columns, and a word set or a pair
 * rule stated at the app's boundary alone is one the other tier writes around. The refusals
 * stand beside the statements they admit (`[SEC3]`, `[TEST7]`).
 *
 * `index.chunk` is LIST-partitioned, so every claim about a column, a CHECK or an index is a
 * claim about a *partition* as much as about the parent — which is why the first two tests ask
 * a partition made after the migration and a partition that was already there.
 */

const db = postgresForSuite();

const WS_A = "01J6EAAAAAAAAAAAAAAAAAAAAA";
const WS_B = "01J6EBBBBBBBBBBBBBBBBBBBBB";

/** The chunk table's columns as `pg_attribute` reports them, parent or partition alike. */
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

/**
 * Which of the two indexes one partition carries: the full-text one every partition is meant
 * to have from migration 0035 onward, and the vector one none of them is meant to have until
 * S8. Asked of a partition twice below — of one made after the migration and of one made
 * before it — and answered the same way both times, because the ruling is that no two
 * partitions differ.
 */
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

/** The workspace, its binding and one catalogued document — what a chunk row locates into. */
const seedOneDocument = async (client: pg.PoolClient, workspaceId: string) => {
  const seed = testData(client);
  await seed.workspace({ id: workspaceId, name: "A" });
  const binding = await seed.sourceBinding({ workspaceId });
  const document = await seed.sourceDocument({ workspaceId, bindingId: binding.id });
  return { seed, binding, document };
};

const INSERT_CHUNK = `INSERT INTO "index".chunk
    (workspace_id, id, content, embedding, embedding_route_id, sensitivity, audience, binding_id)
  VALUES ($1, $2, 'a paragraph of the handbook', $3, $4, 'Internal', 'everyone', $5)`;

/** A vector of the route's width, in the bracketed text form pgvector accepts. */
const VECTOR = JSON.stringify(Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0));

/**
 * The first chunk of one document: ordinal zero, the first forty code points of its normalised
 * redacted text, and the locator that says so. One address written once, because two tests below
 * are about what happens to *the same* address — a second row at it, and the document under it
 * going away.
 */
const firstSpanOf = (documentId: string) => ({
  workspaceId: WS_A,
  sourceDocumentId: documentId,
  locator: "chars:0-40",
  ordinal: 0,
  charStart: 0,
  charEnd: 40,
});

describe("the chunk's columns, on the parent and on a partition", () => {
  it("carries the document, the span and the full-text column on a partition made after them", async () => {
    await withRollback(db().pool, async (client) => {
      const { seed } = await seedOneDocument(client, WS_A);
      await seed.chunk({ workspaceId: WS_A });

      // The whole shape in one assertion (`[TEST9]`): the nine columns the chunk table was
      // created with, the audience array migration 0020 added, and S1's six — the document
      // and its span, and the full-text column the database computes (`s` is *stored*).
      expect(await attributesOf(client, "chunk")).toEqual([
        { column: "id", notNull: true, generated: "" },
        { column: "workspace_id", notNull: true, generated: "" },
        { column: "content", notNull: true, generated: "" },
        { column: "embedding", notNull: false, generated: "" },
        { column: "embedding_route_id", notNull: false, generated: "" },
        { column: "published_at", notNull: false, generated: "" },
        { column: "sensitivity", notNull: true, generated: "" },
        { column: "audience", notNull: true, generated: "" },
        { column: "binding_id", notNull: true, generated: "" },
        { column: "audience_groups", notNull: false, generated: "" },
        { column: "source_document_id", notNull: false, generated: "" },
        { column: "locator", notNull: false, generated: "" },
        { column: "ordinal", notNull: false, generated: "" },
        { column: "char_start", notNull: false, generated: "" },
        { column: "char_end", notNull: false, generated: "" },
        { column: "search", notNull: true, generated: "s" },
      ]);

      // A partition is a table of its own, so it is asked in its own right rather than
      // inferred from the parent — the same reason the direct-query denial is asserted.
      expect(await attributesOf(client, `chunk_${WS_A}`)).toEqual(
        await attributesOf(client, "chunk"),
      );
    });
  });

  it("propagates an ALTER on the parent to a partition that already exists, and to one made after", async () => {
    // Probe 1 of 10/09/2026, written down as a test. The migration added its columns, its
    // CHECK and its generated column to the partitioned parent alone and wrote no
    // per-partition pass, which is only safe because all four shapes reach a partition that
    // is already under the parent. A migrated test database holds no partition at the moment
    // the migration runs, so the claim is made here against the real table with probe
    // objects the rollback takes away.
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
  it("refuses a vector without its route and a route without its vector, and admits both whole shapes", async () => {
    // Nothing embeds until S8 (ADR 0020, amended 2026-09-09), so a chunk lands with no vector
    // — and the two columns are one fact. A row carrying a vector whose route nobody recorded
    // could never be re-embedded against the model that made it, and a row naming a route with
    // no vector is a claim about work that was never done.
    await withRollback(db().pool, async (client) => {
      const { seed } = await seedOneDocument(client, WS_A);
      await seed.chunk({ workspaceId: WS_A });
      const binding = `binding-${ulid()}`;

      const chunkOf = (embedding: string | null, route: string | null) => [
        WS_A,
        `chunk-${ulid()}`,
        embedding,
        route,
        binding,
      ];
      const probe = (values: readonly unknown[]) =>
        refusalOf(client, () => client.query(INSERT_CHUNK, [...values]));

      expect({
        vectorWithoutItsRoute: await probe(chunkOf(VECTOR, null)),
        routeWithoutItsVector: await probe(chunkOf(null, "route-embed")),
        neither: await probe(chunkOf(null, null)),
        both: await probe(chunkOf(VECTOR, "route-embed")),
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
  it("is the database's own work, and refused to both runtime roles", async () => {
    await withRollback(db().pool, async (client) => {
      const { seed } = await seedOneDocument(client, WS_A);
      await seed.chunk({ workspaceId: WS_A, content: "the handbook's holiday policy" });

      const computed = await client.query(
        `SELECT search @@ to_tsquery('english', 'holiday') AS matched FROM "index".chunk`,
      );
      expect(computed.rows[0]?.matched).toBe(true);

      // Neither tier writes this column (the S1 spec): the app's role and the worker's role
      // are each refused a value for it, so a row's full text can never disagree with the
      // content it is over — which is what `find`'s document arm ranks on in T-133.
      for (const role of ["app_rt", "worker_rt"]) {
        await client.query("RESET ROLE");
        await client.query(`SET LOCAL ROLE ${role}`);
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
        await refusesEach(client, [
          [
            `INSERT INTO "index".chunk
               (workspace_id, id, content, sensitivity, audience, binding_id, search)
             VALUES ($1, $2, 'a paragraph', 'Internal', 'everyone', 'binding-1', to_tsvector('english', 'something else'))`,
            `${role} writing a full-text vector of its own on a new row`,
            [WS_A, `chunk-${ulid()}`],
            /non-DEFAULT value/,
          ],
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
  it("gives a new partition its full-text index and no vector index", async () => {
    await withRollback(db().pool, async (client) => {
      const { seed } = await seedOneDocument(client, WS_A);
      await seed.chunk({ workspaceId: WS_A });

      expect(await indexShapeOf(client, `chunk_${WS_A}`)).toEqual({
        fullText: true,
        vector: false,
      });
    });
  });

  it("gives a partition that predates the migration the same pair, through the migration's own loop", async () => {
    // The orchestrator's ruling of 11/09/2026: no two partitions differ. A workspace made
    // before this migration has an HNSW index over a column nothing writes until S8 and no
    // full-text index at all, so the migration walks `pg_inherits` and puts both right. The
    // loop is read out of the shipped migration and run here against a partition built the
    // way migration 0002's function built one, which is the only way to have a partition that
    // predates a migration the harness applies to an empty database.
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
  it("goes when the document goes, and leaves another document's chunks standing", async () => {
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
      // The index is declared once on the parent; Postgres names each partition's copy of it
      // from that partition's own name and shortens the parts to fit the identifier limit, so
      // the refusal a row actually meets names the copy — which is the index the rule is
      // enforced by. The shortened name is written out whole rather than composed from the
      // workspace id, because composing it would state the truncation rule twice.
      expect({ refusedBy: second, declaredOnTheParent: onTheParent.rowCount }).toEqual({
        refusedBy: "chunk_01J6EAAAAAAAAAAAAAAAAAA_workspace_id_source_document__idx",
        declaredOnTheParent: 1,
      });
    });
  });
});

describe("the worker on the chunk index", () => {
  it("writes a chunk row through the parent and is refused the partition itself", async () => {
    // Migration 0000's default privileges in `index` already carry the worker's DML, and this
    // migration writes the three out on the table by name so the ownership map and the journal
    // say one thing (the orchestrator's answer of 11/09/2026). The partition is a table of its
    // own, which the lifecycle function's REVOKE closes and this asserts directly (`[SEC3]`).
    await withRollback(db().pool, async (client) => {
      const { seed, document } = await seedOneDocument(client, WS_A);
      await seed.chunk({ workspaceId: WS_A });

      await client.query("SET LOCAL ROLE worker_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      const id = `chunk-${ulid()}`;
      await client.query(
        `INSERT INTO "index".chunk
           (workspace_id, id, content, sensitivity, audience, binding_id,
            source_document_id, locator, ordinal, char_start, char_end)
         VALUES ($1, $2, 'a paragraph of the handbook', 'Internal', 'everyone', 'binding-1',
                 $3, 'chars:0-40', 0, 0, 40)`,
        [WS_A, id, document.id],
      );
      await client.query(
        `UPDATE "index".chunk SET published_at = now() WHERE workspace_id = $1 AND id = $2`,
        [WS_A, id],
      );
      const published = await client.query(
        `SELECT published_at IS NOT NULL AS published FROM "index".chunk WHERE id = $1`,
        [id],
      );
      await client.query(`DELETE FROM "index".chunk WHERE workspace_id = $1 AND id = $2`, [
        WS_A,
        id,
      ]);
      const afterDelete = await client.query(`SELECT id FROM "index".chunk WHERE id = $1`, [id]);
      expect({ published: published.rows, left: afterDelete.rows }).toEqual({
        published: [{ published: true }],
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

/**
 * One statement of this ticket's substrate migration, found by a word it contains — so a test
 * of what the migration does to partitions that already exist runs the migration's own SQL
 * rather than a second copy of it that could drift.
 */
const migrationStatementMatching = (word: string): string => {
  const file = journalMigrationFiles().find((name) => name.endsWith("the-chunk-substrate.sql"));
  if (file === undefined) throw new Error("the chunk substrate is not in the journal");
  const statement = readFileSync(file, "utf8")
    .split("--> statement-breakpoint")
    .find((part) => part.includes(word));
  if (statement === undefined) throw new Error(`no statement of the chunk substrate says ${word}`);
  return statement;
};
