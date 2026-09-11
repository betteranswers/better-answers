-- Custom migration (hand-written SQL; ADR 0032).
-- The substrate half of migration 0034's pair:
-- the `index` schema's DDL is hand-written in this journal because drizzle-kit reaches only
-- what `drizzle.config.ts`'s `schema` file reaches, and `src/index-tables.ts` sits outside it
-- on purpose. What lands here is the chunk row S1 actually writes — a unit of one document's
-- normalised redacted text, at a span, with no vector — the lifecycle function rewritten for
-- the index that unit needs, and the worker's privileges on the three tables a run touches.
--
-- Every column below mirrors `src/index-tables.ts`, which mirrors this; the two are read
-- against each other by the worker-view drift test and by the boundary schemas over the same
-- declarations.

-- **Nothing embeds until the reserve block S8** (ADR 0020, amended 2026-09-09), so a chunk
-- lands with neither a vector nor the route that would have made one, and both columns lose
-- the NOT NULL the day-one shape gave them.
ALTER TABLE "index".chunk ALTER COLUMN "embedding" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "index".chunk ALTER COLUMN "embedding_route_id" DROP NOT NULL;
--> statement-breakpoint
-- The vector and the route it came from are one fact, kept together by one rule: either the
-- row carries both or it carries neither. A vector whose route nobody recorded could never be
-- re-embedded against the model that made it, and a route with no vector is a claim about work
-- that was never done. Added to the partitioned parent alone, as every ALTER here is: a CHECK,
-- a dropped NOT NULL and a generated column all reach a partition that already exists and one
-- created afterwards, which the probe of 10/09/2026 established and `chunk-columns.test.ts`
-- states as a test.
ALTER TABLE "index".chunk ADD CONSTRAINT "chunk_embedding_pair_check" CHECK ((embedding IS NULL AND embedding_route_id IS NULL) OR (embedding IS NOT NULL AND embedding_route_id IS NOT NULL));
--> statement-breakpoint
-- The document a chunk is a unit of, and the chunk's own locator: a span, `chars:<start>-<end>`
-- in Unicode code points into that document's normalised redacted text, versioned by the
-- redaction string the document row carries. Both are the worker's to write, and both are NULL
-- on no row this block writes — they are nullable only because the table predates them and the
-- rows a suite seeds for the visibility columns alone name no document.
ALTER TABLE "index".chunk ADD COLUMN "source_document_id" text;
--> statement-breakpoint
ALTER TABLE "index".chunk ADD COLUMN "locator" text;
--> statement-breakpoint
-- The splitter's position, on the row rather than parsed back out of the locator: the chunk's
-- id is derived from the document and this number, so a read that has the row never has to
-- take a string apart to learn where the unit sits.
ALTER TABLE "index".chunk ADD COLUMN "ordinal" integer;
--> statement-breakpoint
-- The same span as two numbers, so a locator's range resolves to its covering rows by two
-- comparisons rather than by parsing every candidate's locator.
ALTER TABLE "index".chunk ADD COLUMN "char_start" integer;
--> statement-breakpoint
ALTER TABLE "index".chunk ADD COLUMN "char_end" integer;
--> statement-breakpoint
-- The full-text vector, computed by the database from the row's content and written by
-- neither tier. Generated rather than a column a writer fills for the reason the visibility
-- copies are not: there is exactly one right value for it, the content decides it, and a
-- column two tiers could write is a column whose full text can disagree with the text it is
-- over. The English configuration is stated as a literal so the expression is immutable, which
-- is what a stored generated column requires.
ALTER TABLE "index".chunk ADD COLUMN "search" tsvector NOT NULL GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;
--> statement-breakpoint
-- Keyed by the pair, as every cross-table key in this package is: a foreign-key check runs
-- outside row-level security, so a key on the document id alone would confirm that some other
-- tenant holds a given document. CASCADE and not RESTRICT, which is the opposite of the key
-- `evidence` takes to the same table and deliberately so — cited evidence outlives its source
-- (ADR 0013) and a chunk does not: a chunk is a copy of text the catalogue still holds, and a
-- document that goes takes its copies with it.
ALTER TABLE "index".chunk ADD CONSTRAINT "chunk_source_document_fk" FOREIGN KEY ("workspace_id", "source_document_id") REFERENCES public."source_document"("workspace_id", "id") ON DELETE CASCADE;
--> statement-breakpoint
-- One row per span of one document: a reprocess upserts on the chunk's derived id, and this is
-- the same fact keyed the way a reader addresses it. The workspace leads because it is the
-- partition key, which a unique index on a partitioned table has to carry.
CREATE UNIQUE INDEX "chunk_workspace_id_source_document_id_locator_uidx" ON "index".chunk ("workspace_id", "source_document_id", "locator");
--> statement-breakpoint
-- **The lifecycle function, replaced.** Everything migration 0002 wrote about it still holds:
-- the owner DSN reaches `migrate` alone, so the per-workspace partition is created by this
-- definer function with its search_path pinned, every object it names schema-qualified, EXECUTE
-- revoked from PUBLIC and granted to the app's role alone, and all of it in the caller's one
-- transaction. The two guards before any DDL are unchanged and are the reason a definer
-- function is safe here: the caller's transaction must already be scoped to the workspace it
-- names, and the workspace row must exist. The REVOKE after the CREATE closes the same leak it
-- always did — parent policies do not apply to a query aimed at a child, and migration 0000's
-- default privileges in `index` would otherwise hand both runtime roles DML on the partition.
--
-- What changes is the index a new partition is born with. The HNSW line leaves: it built an
-- index over a column nothing writes until S8, which cost every new workspace a build and a
-- resident structure for nothing. A GIN index over the full-text column takes its place,
-- because that column is what `find`'s document arm matches on from this block onward. The
-- index stays per-partition rather than moving to the parent for the reason ADR 0007 gives
-- about the vector index: one workspace's recall is not another's, and a partition's index is
-- built, rebuilt and dropped with the workspace it belongs to.
--
-- A replace and not a drop-and-create: the argument list does not change, so the function keeps
-- its identity and the EXECUTE grant made on that signature stands. Migration 0033 had to drop
-- and create because `claim_job` grew an argument, which is a different situation and not the
-- pattern to copy.
CREATE OR REPLACE FUNCTION public.create_workspace_partition(p_workspace_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_workspace_id IS DISTINCT FROM nullif(current_setting('app.workspace_id', true), '') THEN
    RAISE EXCEPTION 'create_workspace_partition: the transaction is not scoped to workspace %', p_workspace_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspace WHERE id = p_workspace_id) THEN
    RAISE EXCEPTION 'create_workspace_partition: no such workspace %', p_workspace_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  EXECUTE format(
    'CREATE TABLE "index".%I PARTITION OF "index".chunk FOR VALUES IN (%L)',
    'chunk_' || p_workspace_id, p_workspace_id);
  EXECUTE format(
    'REVOKE ALL ON "index".%I FROM app_rt, worker_rt',
    'chunk_' || p_workspace_id);
  EXECUTE format(
    'CREATE INDEX %I ON "index".%I USING gin (search)',
    'chunk_' || p_workspace_id || '_search_gin', 'chunk_' || p_workspace_id);
END $$;
--> statement-breakpoint
-- **The partitions that already exist**, brought to the same shape in the same migration, so no
-- two workspaces differ by the day they were provisioned. A workspace created before today has
-- an HNSW index over a column nothing has written and no full-text index at all; this walks the
-- parent's children and puts both right. `IF EXISTS` and `IF NOT EXISTS` are here because the
-- statement describes the shape a partition must end in rather than a sequence of changes it
-- must have needed — an estate part-way there is left correct rather than refused.
DO $$
DECLARE
  partition_name text;
BEGIN
  FOR partition_name IN
    SELECT child.relname
      FROM pg_catalog.pg_inherits inherits
      JOIN pg_catalog.pg_class child ON child.oid = inherits.inhrelid
      JOIN pg_catalog.pg_class parent ON parent.oid = inherits.inhparent
      JOIN pg_catalog.pg_namespace parent_schema ON parent_schema.oid = parent.relnamespace
     WHERE parent_schema.nspname = 'index' AND parent.relname = 'chunk'
  LOOP
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON "index".%I USING gin (search)',
      partition_name || '_search_gin', partition_name);
    EXECUTE format(
      'DROP INDEX IF EXISTS "index".%I',
      partition_name || '_embedding_hnsw');
  END LOOP;
END $$;
--> statement-breakpoint
-- **The worker's privileges on this block's tables, re-granted.** Migration 0000's default
-- privileges handed both runtime roles DML on every table in `public`, and migration 0020 took
-- the six derivation tables back off the worker because it read none of them. S1 is the block
-- where a run reads two of them, so exactly what a run needs comes back and no more: the
-- binding, to copy its class and audience onto the rows the run writes, is read and never
-- written — a binding is what an Admin made, and the tier that indexes it has no say in it.
GRANT SELECT ON public."source_binding" TO worker_rt;
--> statement-breakpoint
-- The document catalogue is the one thing a run reconciles: the hash it computed, the key of
-- the normalised copy it wrote, the redaction version the seam returned, the outcome word and
-- when it last saw the item. So SELECT and UPDATE, and neither INSERT nor DELETE — a document
-- row is created by the act that bound its source and removed by the act that withdraws it,
-- both of them the app's, and a worker that could insert one could catalogue a document nobody
-- uploaded.
GRANT SELECT, UPDATE ON public."source_document" TO worker_rt;
--> statement-breakpoint
-- Written out rather than left to the default privilege that already carries it, so the
-- journal and the table-ownership map say the same thing and the worker's hold on the chunk
-- index does not rest on a default nobody reads. The three are what a run does: it writes the
-- rows it split, rewrites them on a reprocess, and deletes the rows of a document that has gone
-- from the source. Reaching them through the policied parent is the whole of its access — the
-- lifecycle function's REVOKE above closes every partition to it.
GRANT INSERT, UPDATE, DELETE ON "index".chunk TO worker_rt;
