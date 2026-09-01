-- Custom migration (hand-written SQL; ADR 0032).
-- The `index` schema's DDL (drizzle-orm 0.45.2 has no partitioning API), FORCE ROW
-- LEVEL SECURITY on every tenant table this journal has created, the one SECURITY
-- DEFINER workspace-lifecycle function, and the llm-routing SQL function (ADR 0031).

-- Mirrors src/index-tables.ts column for column — the worker-view drift test fails if
-- the two part. vector(1024): mistral-embed's fixed output dimension ([DEPS1],
-- 01/09/2026); the per-partition HNSW index is the lifecycle function's, for the
-- recall-isolation reason ADR 0007 gives.
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
) PARTITION BY LIST ("workspace_id");
--> statement-breakpoint
ALTER TABLE "index".chunk ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "chunk_workspace_isolation" ON "index".chunk AS PERMISSIVE FOR ALL TO public
  USING ("workspace_id" = (select current_workspace_id()))
  WITH CHECK ("workspace_id" = (select current_workspace_id()));
--> statement-breakpoint
-- FORCE applies RLS to the table's owner too, so not even a mis-wired owner
-- connection reads across tenants (`[DESIGN4]`).
ALTER TABLE "workspace" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "llm_route" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "index".chunk FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The ONE runtime-DDL path (ADR 0032): the owner DSN reaches `migrate` only, so the
-- per-workspace partition and its HNSW index are created by this definer function —
-- search_path pinned, EXECUTE app_rt-only, all objects in the caller's one
-- transaction. Identifiers via format(%I/%L); everything else schema-qualified
-- because the pinned search_path cannot see `public` or `index`.
--
-- Two guards before any DDL: the caller's transaction must already be scoped to the
-- workspace it names (a definer function must not let one tenant's request create
-- another tenant's objects), and the workspace row must exist.
--
-- The REVOKE after the CREATE closes a real leak: migration 0000's default
-- privileges in "index" grant the runtime roles DML on every new table, and parent
-- policies do not apply to a query aimed directly at a child — so without it,
-- `SELECT FROM "index".chunk_<other_tenant>` would bypass RLS entirely. Access to
-- chunk rows is through the parent table alone.
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
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION create_workspace_partition(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION create_workspace_partition(text) TO app_rt;
--> statement-breakpoint
-- llm-routing (ADR 0031): one route per workspace per purpose, resolved by the
-- database, never twice in code. SECURITY INVOKER on purpose — the caller's RLS
-- applies, so a missing scope resolves to zero rows, and the unique index above
-- guarantees at most one. Schema-qualified throughout rather than search_path-pinned
-- (a pg_temp object must not shadow either name, and a SET clause would block the
-- planner from inlining a STABLE sql function).
CREATE FUNCTION llm_route_for(p_purpose llm_purpose) RETURNS SETOF llm_route
LANGUAGE sql STABLE
AS $$
  SELECT * FROM public.llm_route
  WHERE purpose = p_purpose
    AND workspace_id = (SELECT public.current_workspace_id())
$$;
