-- Custom migration (hand-written SQL; ADR 0032).
CREATE FUNCTION public.analyse_map() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
AS $$
BEGIN
  ANALYZE public.map_node, public.map_edge;
END $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.analyse_map() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.analyse_map() TO app_rt, worker_rt;--> statement-breakpoint
ALTER TABLE public.map_node SET (autovacuum_analyze_scale_factor = 0.01, autovacuum_analyze_threshold = 50);--> statement-breakpoint
ALTER TABLE public.map_edge SET (autovacuum_analyze_scale_factor = 0.01, autovacuum_analyze_threshold = 50);
