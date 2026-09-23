-- Custom migration (hand-written SQL; ADR 0032).

CREATE TABLE "index".chunk (
	"id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"embedding_route_id" text NOT NULL,
	"published_at" timestamp with time zone,
	"sensitivity" text NOT NULL,
	"audience" text NOT NULL,
	"binding_id" text NOT NULL,
	PRIMARY KEY ("workspace_id", "id")
) PARTITION BY LIST ("workspace_id");--> statement-breakpoint
ALTER TABLE "index".chunk ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "chunk_workspace_isolation" ON "index".chunk AS PERMISSIVE FOR ALL TO public
  USING ("workspace_id" = (select current_workspace_id()))
  WITH CHECK ("workspace_id" = (select current_workspace_id()));--> statement-breakpoint
ALTER TABLE "workspace" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "llm_route" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "index".chunk FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE FUNCTION create_workspace_partition(p_workspace_id text) RETURNS void
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
    'CREATE INDEX %I ON "index".%I USING hnsw (embedding public.vector_cosine_ops)',
    'chunk_' || p_workspace_id || '_embedding_hnsw', 'chunk_' || p_workspace_id);
END $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION create_workspace_partition(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION create_workspace_partition(text) TO app_rt;--> statement-breakpoint
CREATE FUNCTION llm_route_for(p_purpose llm_purpose) RETURNS SETOF llm_route
LANGUAGE sql STABLE
AS $$
  SELECT * FROM public.llm_route
  WHERE purpose = p_purpose
    AND workspace_id = (SELECT public.current_workspace_id())
$$;
