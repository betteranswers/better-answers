-- Custom migration (hand-written SQL; ADR 0032).

-- The engine tracks landed rows under the table's name, so a renamed target loses every deletion
-- silently; the release runs each connected source through the `wiped` reason after this.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "index".chunk RENAME TO passage;--> statement-breakpoint
ALTER TABLE "index".passage RENAME COLUMN binding_id TO connected_source_id;--> statement-breakpoint
ALTER TABLE "index".passage RENAME COLUMN embedding_route_id TO embedding_model_choice_id;--> statement-breakpoint
ALTER POLICY "chunk_workspace_isolation" ON "index".passage RENAME TO "passage_workspace_isolation";--> statement-breakpoint
ALTER INDEX "index".chunk_pkey RENAME TO passage_pkey;--> statement-breakpoint
ALTER INDEX "index".chunk_workspace_id_binding_id_source_document_id_ordinal_idx
  RENAME TO passage_workspace_connected_source_document_ordinal_idx;--> statement-breakpoint
ALTER INDEX "index".chunk_workspace_id_source_document_id_locator_uidx
  RENAME TO passage_workspace_id_source_document_id_locator_uidx;--> statement-breakpoint
-- Each partition carries its parent's constraint names and its own table and index names.
DO $$
DECLARE
  part record;
  con record;
  child record;
  workspace text;
BEGIN
  FOR con IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = '"index".passage'::regclass AND conname LIKE 'chunk\_%'
  LOOP
    EXECUTE format('ALTER TABLE "index".passage RENAME CONSTRAINT %I TO %I', con.conname,
      replace(replace(con.conname, 'chunk_', 'passage_'), 'binding_id', 'connected_source_id'));
  END LOOP;
  FOR part IN
    SELECT c.oid, c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
     WHERE i.inhparent = '"index".passage'::regclass
  LOOP
    workspace := substr(part.relname, length('chunk_') + 1);
    FOR con IN
      SELECT conname FROM pg_constraint WHERE conrelid = part.oid AND conname LIKE 'chunk\_%'
        AND contype <> 'p'
    LOOP
      EXECUTE format('ALTER TABLE "index".%I RENAME CONSTRAINT %I TO %I', part.relname, con.conname,
        replace(replace(con.conname, 'chunk_', 'passage_'), 'binding_id', 'connected_source_id'));
    END LOOP;
    FOR child IN
      SELECT ci.relname AS name, pi.relname AS parent FROM pg_index x
        JOIN pg_class ci ON ci.oid = x.indexrelid
        LEFT JOIN pg_inherits ii ON ii.inhrelid = x.indexrelid
        LEFT JOIN pg_class pi ON pi.oid = ii.inhparent
       WHERE x.indrelid = part.oid
    LOOP
      EXECUTE format('ALTER INDEX "index".%I RENAME TO %I', child.name,
        CASE child.parent
          WHEN 'passage_pkey' THEN 'passage_' || workspace || '_pkey'
          WHEN 'passage_workspace_connected_source_document_ordinal_idx'
            THEN 'passage_' || workspace || '_connected_source_idx'
          WHEN 'passage_workspace_id_source_document_id_locator_uidx'
            THEN 'passage_' || workspace || '_locator_uidx'
          ELSE replace(child.name, 'chunk_', 'passage_')
        END);
    END LOOP;
    EXECUTE format('ALTER TABLE "index".%I RENAME TO %I', part.relname, 'passage_' || workspace);
  END LOOP;
END $$;--> statement-breakpoint
-- A view keeps its own column names, so they move with the table's; renamed in place, it keeps
-- `security_invoker` and its grants.
ALTER VIEW "index".readable_chunk RENAME TO readable_passage;--> statement-breakpoint
ALTER VIEW "index".readable_passage RENAME COLUMN binding_id TO connected_source_id;--> statement-breakpoint
ALTER VIEW "index".readable_passage RENAME COLUMN embedding_route_id TO embedding_model_choice_id;--> statement-breakpoint
-- Replaced, never recreated: a function made afresh is executable by PUBLIC. The child indexes are
-- made before the attach, which adopts them, so a new partition's names match an old one's.
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
  -- What a partition inherits and no more: ALL would copy the parent's comments and statistics too.
  EXECUTE format(
    'CREATE TABLE "index".%I (LIKE "index".passage INCLUDING DEFAULTS INCLUDING GENERATED'
    ' INCLUDING CONSTRAINTS INCLUDING STORAGE INCLUDING COMPRESSION)',
    'passage_' || p_workspace_id);
  EXECUTE format(
    'REVOKE ALL ON "index".%I FROM app_rt, worker_rt',
    'passage_' || p_workspace_id);
  EXECUTE format(
    'CREATE INDEX %I ON "index".%I USING gin (search)',
    'passage_' || p_workspace_id || '_search_gin', 'passage_' || p_workspace_id);
  EXECUTE format(
    'CREATE INDEX %I ON "index".%I (workspace_id, connected_source_id, source_document_id, ordinal)',
    'passage_' || p_workspace_id || '_connected_source_idx', 'passage_' || p_workspace_id);
  EXECUTE format(
    'CREATE UNIQUE INDEX %I ON "index".%I (workspace_id, source_document_id, locator)',
    'passage_' || p_workspace_id || '_locator_uidx', 'passage_' || p_workspace_id);
  EXECUTE format(
    'ALTER TABLE "index".passage ATTACH PARTITION "index".%I FOR VALUES IN (%L)',
    'passage_' || p_workspace_id, p_workspace_id);
END $$;--> statement-breakpoint
-- The CHECK goes first so its old value can be rewritten. Row-level security is forced and a
-- migration runs as the owner, so the update takes each row's workspace scope.
ALTER TABLE "connected_source" DROP CONSTRAINT "connected_source_destination_check";--> statement-breakpoint
DO $$
DECLARE
  scope text;
BEGIN
  FOR scope IN SELECT id FROM public.workspace LOOP
    PERFORM set_config('app.workspace_id', scope, true);
    UPDATE public.connected_source
       SET destination = array_replace(destination, 'chunk-index', 'passage-index')
     WHERE 'chunk-index' = ANY (destination);
  END LOOP;
  PERFORM set_config('app.workspace_id', '', true);
END $$;--> statement-breakpoint
ALTER TABLE "connected_source" ALTER COLUMN "destination" SET DEFAULT '{"passage-index","bundle"}';--> statement-breakpoint
-- ADD CONSTRAINT validates every row standing, so no old value survives it.
ALTER TABLE "connected_source" ADD CONSTRAINT "connected_source_destination_check" CHECK (cardinality(destination) > 0
         AND array_position(destination, NULL) IS NULL
         AND destination <@ ARRAY['passage-index', 'bundle', 'map']::text[]);--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
