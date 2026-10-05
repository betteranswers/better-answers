-- Custom migration (hand-written SQL; ADR 0032).
-- The graph becomes the map: its three tables, everything named after them, the triggers and the
-- functions that guard its generations, the destination a connected source names it by, and the
-- rebuild reason a first build gives. A rename takes an ACCESS EXCLUSIVE lock; five seconds bounds
-- the wait behind a reader, and a failed release is re-run by hand.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "graph_generation" RENAME TO "map_generation";--> statement-breakpoint
ALTER TABLE "map_generation" RENAME CONSTRAINT "graph_generation_pkey" TO "map_generation_pkey";--> statement-breakpoint
ALTER TABLE "map_generation" RENAME CONSTRAINT "graph_generation_workspace_id_fkey" TO "map_generation_workspace_id_fkey";--> statement-breakpoint
ALTER TABLE "map_generation" RENAME CONSTRAINT "graph_generation_live_gen_check" TO "map_generation_live_gen_check";--> statement-breakpoint
ALTER TABLE "map_generation" RENAME CONSTRAINT "graph_generation_workspace_id_not_null" TO "map_generation_workspace_id_not_null";--> statement-breakpoint
ALTER TABLE "map_generation" RENAME CONSTRAINT "graph_generation_live_gen_not_null" TO "map_generation_live_gen_not_null";--> statement-breakpoint
ALTER POLICY "graph_generation_workspace_isolation" ON "map_generation" RENAME TO "map_generation_workspace_isolation";--> statement-breakpoint
ALTER TRIGGER "graph_generation_flip_guard" ON "map_generation" RENAME TO "map_generation_flip_guard";--> statement-breakpoint
ALTER TABLE "graph_node" RENAME TO "map_node";--> statement-breakpoint
ALTER TABLE "map_node" RENAME CONSTRAINT "graph_node_workspace_id_fkey" TO "map_node_workspace_id_fkey";--> statement-breakpoint
ALTER TABLE "map_node" RENAME CONSTRAINT "graph_node_label_check" TO "map_node_label_check";--> statement-breakpoint
ALTER TABLE "map_node" RENAME CONSTRAINT "graph_node_gen_check" TO "map_node_gen_check";--> statement-breakpoint
ALTER TABLE "map_node" RENAME CONSTRAINT "graph_node_sensitivity_check" TO "map_node_sensitivity_check";--> statement-breakpoint
ALTER TABLE "map_node" RENAME CONSTRAINT "graph_node_audience_check" TO "map_node_audience_check";--> statement-breakpoint
ALTER TABLE "map_node" RENAME CONSTRAINT "graph_node_workspace_id_not_null" TO "map_node_workspace_id_not_null";--> statement-breakpoint
ALTER TABLE "map_node" RENAME CONSTRAINT "graph_node_uid_not_null" TO "map_node_uid_not_null";--> statement-breakpoint
ALTER TABLE "map_node" RENAME CONSTRAINT "graph_node_label_not_null" TO "map_node_label_not_null";--> statement-breakpoint
ALTER TABLE "map_node" RENAME CONSTRAINT "graph_node_sensitivity_not_null" TO "map_node_sensitivity_not_null";--> statement-breakpoint
ALTER TABLE "map_node" RENAME CONSTRAINT "graph_node_audience_not_null" TO "map_node_audience_not_null";--> statement-breakpoint
ALTER INDEX "graph_node_bundle_uidx" RENAME TO "map_node_bundle_uidx";--> statement-breakpoint
ALTER INDEX "graph_node_source_entity_uidx" RENAME TO "map_node_source_entity_uidx";--> statement-breakpoint
ALTER INDEX "graph_node_kind_idx" RENAME TO "map_node_kind_idx";--> statement-breakpoint
ALTER POLICY "graph_node_workspace_isolation" ON "map_node" RENAME TO "map_node_workspace_isolation";--> statement-breakpoint
ALTER TRIGGER "graph_node_generation_guard" ON "map_node" RENAME TO "map_node_generation_guard";--> statement-breakpoint
ALTER TABLE "graph_edge" RENAME TO "map_edge";--> statement-breakpoint
ALTER TABLE "map_edge" RENAME CONSTRAINT "graph_edge_workspace_id_fkey" TO "map_edge_workspace_id_fkey";--> statement-breakpoint
ALTER TABLE "map_edge" RENAME CONSTRAINT "graph_edge_label_check" TO "map_edge_label_check";--> statement-breakpoint
ALTER TABLE "map_edge" RENAME CONSTRAINT "graph_edge_gen_check" TO "map_edge_gen_check";--> statement-breakpoint
ALTER TABLE "map_edge" RENAME CONSTRAINT "graph_edge_sensitivity_check" TO "map_edge_sensitivity_check";--> statement-breakpoint
ALTER TABLE "map_edge" RENAME CONSTRAINT "graph_edge_audience_check" TO "map_edge_audience_check";--> statement-breakpoint
ALTER TABLE "map_edge" RENAME CONSTRAINT "graph_edge_links_to_check" TO "map_edge_links_to_check";--> statement-breakpoint
ALTER TABLE "map_edge" RENAME CONSTRAINT "graph_edge_workspace_id_not_null" TO "map_edge_workspace_id_not_null";--> statement-breakpoint
ALTER TABLE "map_edge" RENAME CONSTRAINT "graph_edge_uid_not_null" TO "map_edge_uid_not_null";--> statement-breakpoint
ALTER TABLE "map_edge" RENAME CONSTRAINT "graph_edge_label_not_null" TO "map_edge_label_not_null";--> statement-breakpoint
ALTER TABLE "map_edge" RENAME CONSTRAINT "graph_edge_from_uid_not_null" TO "map_edge_from_uid_not_null";--> statement-breakpoint
ALTER TABLE "map_edge" RENAME CONSTRAINT "graph_edge_to_uid_not_null" TO "map_edge_to_uid_not_null";--> statement-breakpoint
ALTER TABLE "map_edge" RENAME CONSTRAINT "graph_edge_sensitivity_not_null" TO "map_edge_sensitivity_not_null";--> statement-breakpoint
ALTER TABLE "map_edge" RENAME CONSTRAINT "graph_edge_audience_not_null" TO "map_edge_audience_not_null";--> statement-breakpoint
ALTER INDEX "graph_edge_bundle_uidx" RENAME TO "map_edge_bundle_uidx";--> statement-breakpoint
ALTER INDEX "graph_edge_source_entity_uidx" RENAME TO "map_edge_source_entity_uidx";--> statement-breakpoint
ALTER INDEX "graph_edge_from_idx" RENAME TO "map_edge_from_idx";--> statement-breakpoint
ALTER INDEX "graph_edge_to_idx" RENAME TO "map_edge_to_idx";--> statement-breakpoint
ALTER POLICY "graph_edge_workspace_isolation" ON "map_edge" RENAME TO "map_edge_workspace_isolation";--> statement-breakpoint
ALTER TRIGGER "graph_edge_generation_guard" ON "map_edge" RENAME TO "map_edge_generation_guard";--> statement-breakpoint
-- RENAME keeps each function's grants. The flip guard's body names no table; the row guard's names
-- the generation table, so it is replaced after, with its search_path restated.
ALTER FUNCTION public.graph_generation_flip_guard() RENAME TO map_generation_flip_guard;--> statement-breakpoint
ALTER FUNCTION public.graph_row_generation_guard() RENAME TO map_row_generation_guard;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.map_row_generation_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  live integer;
BEGIN
  -- A generation before the first is the row's own CHECK's to refuse, by its own name.
  IF NEW.gen IS NULL OR NEW.gen < 1 THEN
    RETURN NEW;
  END IF;
  SELECT g.live_gen INTO live FROM public.map_generation g WHERE g.workspace_id = NEW.workspace_id;
  IF live IS NULL OR NEW.gen NOT IN (live, live + 1) THEN
    RAISE EXCEPTION 'a map row lands in the live generation or the next: live is %, % refused',
      live, NEW.gen
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
-- Migration 0066 renamed the model choice's table but not the NOT NULL constraints PostgreSQL 18
-- had named after the old one.
ALTER TABLE "model_choice" RENAME CONSTRAINT "llm_route_id_not_null" TO "model_choice_id_not_null";--> statement-breakpoint
ALTER TABLE "model_choice" RENAME CONSTRAINT "llm_route_workspace_id_not_null" TO "model_choice_workspace_id_not_null";--> statement-breakpoint
ALTER TABLE "model_choice" RENAME CONSTRAINT "llm_route_purpose_not_null" TO "model_choice_purpose_not_null";--> statement-breakpoint
ALTER TABLE "model_choice" RENAME CONSTRAINT "llm_route_provider_not_null" TO "model_choice_provider_not_null";--> statement-breakpoint
ALTER TABLE "model_choice" RENAME CONSTRAINT "llm_route_model_not_null" TO "model_choice_model_not_null";--> statement-breakpoint
-- Each CHECK goes first so its old value can be rewritten. Row-level security is forced on both
-- tables and a migration runs as the owner, so the updates take each row's workspace scope.
ALTER TABLE "source_binding" DROP CONSTRAINT "source_binding_destination_check";--> statement-breakpoint
ALTER TABLE "job" DROP CONSTRAINT "job_reason_check";--> statement-breakpoint
DO $$
DECLARE
  scope text;
BEGIN
  FOR scope IN SELECT id FROM public.workspace LOOP
    PERFORM set_config('app.workspace_id', scope, true);
    UPDATE public.source_binding SET destination = array_replace(destination, 'graph', 'map')
      WHERE 'graph' = ANY (destination);
    UPDATE public.job SET reason = 'first-build'
      WHERE kind = 'full-rebuild' AND reason = 'first-sync';
  END LOOP;
  PERFORM set_config('app.workspace_id', '', true);
END $$;--> statement-breakpoint
-- ADD CONSTRAINT validates every row standing, so no old value survives it.
ALTER TABLE "source_binding" ADD CONSTRAINT "source_binding_destination_check" CHECK (cardinality(destination) > 0
         AND array_position(destination, NULL) IS NULL
         AND destination <@ ARRAY['chunk-index', 'bundle', 'map']::text[]);--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_reason_check" CHECK ((reason IS NOT NULL) = (kind IN ('full-rebuild', 'index'))
         AND (reason IS NULL OR (kind, reason) IN (('full-rebuild', 'first-build'), ('full-rebuild', 'model-choice-change'), ('full-rebuild', 'reconciler'), ('full-rebuild', 'erasure'), ('full-rebuild', 'upgrade'), ('full-rebuild', 'drill'), ('index', 'bound'), ('index', 'restored'), ('index', 'dismissed'), ('index', 'rule-change'), ('index', 'wiped'))));--> statement-breakpoint
-- Every pending migration runs in one transaction, so the bound ends with this one.
SET LOCAL lock_timeout = DEFAULT;
