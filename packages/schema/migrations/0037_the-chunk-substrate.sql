-- Custom migration (hand-written SQL; ADR 0032).

ALTER TABLE "index".chunk ALTER COLUMN "embedding" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "index".chunk ALTER COLUMN "embedding_route_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "index".chunk ADD CONSTRAINT "chunk_embedding_pair_check" CHECK ((embedding IS NULL AND embedding_route_id IS NULL) OR (embedding IS NOT NULL AND embedding_route_id IS NOT NULL));--> statement-breakpoint
ALTER TABLE "index".chunk ADD COLUMN "source_document_id" text;--> statement-breakpoint
ALTER TABLE "index".chunk ADD COLUMN "locator" text;--> statement-breakpoint
ALTER TABLE "index".chunk ADD COLUMN "ordinal" integer;--> statement-breakpoint
-- The same span as two numbers, so a locator's range resolves to its covering rows by two
-- comparisons rather than by parsing every candidate's locator.
ALTER TABLE "index".chunk ADD COLUMN "char_start" integer;--> statement-breakpoint
ALTER TABLE "index".chunk ADD COLUMN "char_end" integer;--> statement-breakpoint
ALTER TABLE "index".chunk ADD COLUMN "search" tsvector NOT NULL GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;--> statement-breakpoint
ALTER TABLE "index".chunk ADD CONSTRAINT "chunk_source_document_fk" FOREIGN KEY ("workspace_id", "source_document_id") REFERENCES public."source_document"("workspace_id", "id") ON DELETE CASCADE;--> statement-breakpoint
CREATE UNIQUE INDEX "chunk_workspace_id_source_document_id_locator_uidx" ON "index".chunk ("workspace_id", "source_document_id", "locator");--> statement-breakpoint
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
END $$;--> statement-breakpoint
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
END $$;--> statement-breakpoint
GRANT SELECT ON public."source_binding" TO worker_rt;--> statement-breakpoint
GRANT SELECT, UPDATE ON public."source_document" TO worker_rt;--> statement-breakpoint
GRANT INSERT, UPDATE, DELETE ON "index".chunk TO worker_rt;
