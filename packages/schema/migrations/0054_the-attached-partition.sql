-- Custom migration (hand-written SQL; ADR 0032).

-- Attached rather than `PARTITION OF`, which holds the shared parent ACCESS EXCLUSIVE while waiting
-- on `source_document`: a cycle with any writer of documents.
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
    'CREATE TABLE "index".%I (LIKE "index".chunk INCLUDING DEFAULTS INCLUDING GENERATED'
    ' INCLUDING CONSTRAINTS INCLUDING STORAGE INCLUDING COMPRESSION)',
    'chunk_' || p_workspace_id);
  EXECUTE format(
    'REVOKE ALL ON "index".%I FROM app_rt, worker_rt',
    'chunk_' || p_workspace_id);
  EXECUTE format(
    'CREATE INDEX %I ON "index".%I USING gin (search)',
    'chunk_' || p_workspace_id || '_search_gin', 'chunk_' || p_workspace_id);
  EXECUTE format(
    'ALTER TABLE "index".chunk ATTACH PARTITION "index".%I FOR VALUES IN (%L)',
    'chunk_' || p_workspace_id, p_workspace_id);
END $$;
