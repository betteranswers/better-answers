-- Custom migration (hand-written SQL; ADR 0032).
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM worker_rt;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "index" REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM worker_rt;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "job" TO worker_rt;--> statement-breakpoint
GRANT SELECT ON "workspace" TO worker_rt;--> statement-breakpoint
GRANT SELECT ON "index".chunk TO worker_rt;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON "llm_route" FROM worker_rt;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON "workspace_config" FROM worker_rt;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.current_workspace_id() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.current_workspace_id() TO app_rt, worker_rt;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.llm_route_for(llm_purpose) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.llm_route_for(llm_purpose) TO app_rt;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.suggestion_decides_once() FROM PUBLIC;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.graph_generation_flip_guard() FROM PUBLIC;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.graph_row_generation_guard() FROM PUBLIC;
