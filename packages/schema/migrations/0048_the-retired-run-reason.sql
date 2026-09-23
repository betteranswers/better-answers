-- Custom migration (hand-written SQL; ADR 0032).
-- Row-level security is forced on `job` and a migration runs as the owner, so the delete
-- takes each row's workspace scope.
DO $$
DECLARE
  scope text;
BEGIN
  FOR scope IN SELECT id FROM public.workspace LOOP
    PERFORM set_config('app.workspace_id', scope, true);
    DELETE FROM public.job WHERE kind = 'index' AND reason = 'narrowed';
  END LOOP;
  PERFORM set_config('app.workspace_id', '', true);
END $$;--> statement-breakpoint
-- The rows go first, because ADD CONSTRAINT validates every row already standing.
ALTER TABLE "job" DROP CONSTRAINT "job_reason_check";--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_reason_check" CHECK ((reason IS NOT NULL) = (kind IN ('full-rebuild', 'index'))
         AND (reason IS NULL OR (kind, reason) IN (('full-rebuild', 'first-sync'), ('full-rebuild', 'route-change'), ('full-rebuild', 'reconciler'), ('full-rebuild', 'erasure'), ('full-rebuild', 'upgrade'), ('full-rebuild', 'drill'), ('index', 'bound'), ('index', 'restored'), ('index', 'rule-change'), ('index', 'wiped'))));
