-- Custom migration (hand-written SQL; ADR 0032).
-- The route row becomes the model choice: the table, everything named after it, the function that
-- resolves it, and the rebuild reason it gives. A rename takes an ACCESS EXCLUSIVE lock; five
-- seconds bounds the wait behind a reader, and a failed release is re-run by hand.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "llm_route" RENAME TO "model_choice";--> statement-breakpoint
ALTER TABLE "model_choice" RENAME CONSTRAINT "llm_route_pkey" TO "model_choice_pkey";--> statement-breakpoint
ALTER TABLE "model_choice" RENAME CONSTRAINT "llm_route_workspace_id_workspace_id_fk" TO "model_choice_workspace_id_workspace_id_fk";--> statement-breakpoint
ALTER TABLE "model_choice" RENAME CONSTRAINT "llm_route_dimensions_check" TO "model_choice_dimensions_check";--> statement-breakpoint
ALTER INDEX "llm_route_workspace_purpose_unique" RENAME TO "model_choice_workspace_purpose_unique";--> statement-breakpoint
ALTER POLICY "llm_route_workspace_isolation" ON "model_choice" RENAME TO "model_choice_workspace_isolation";--> statement-breakpoint
-- RENAME keeps the function's grants; its body names the table, so it is replaced after.
ALTER FUNCTION public.llm_route_for(llm_purpose) RENAME TO model_choice_for;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.model_choice_for(p_purpose llm_purpose) RETURNS SETOF public.model_choice
LANGUAGE sql STABLE
AS $$
  SELECT * FROM public.model_choice
  WHERE purpose = p_purpose
    AND workspace_id = (SELECT public.current_workspace_id())
$$;--> statement-breakpoint
-- The CHECK goes first so the old value can be rewritten. Row-level security is forced on `job` and
-- a migration runs as the owner, so the update takes each row's workspace scope.
ALTER TABLE "job" DROP CONSTRAINT "job_reason_check";--> statement-breakpoint
DO $$
DECLARE
  scope text;
BEGIN
  FOR scope IN SELECT id FROM public.workspace LOOP
    PERFORM set_config('app.workspace_id', scope, true);
    UPDATE public.job SET reason = 'model-choice-change'
      WHERE kind = 'full-rebuild' AND reason = 'route-change';
  END LOOP;
  PERFORM set_config('app.workspace_id', '', true);
END $$;--> statement-breakpoint
-- ADD CONSTRAINT validates every row standing, so no old value survives it.
ALTER TABLE "job" ADD CONSTRAINT "job_reason_check" CHECK ((reason IS NOT NULL) = (kind IN ('full-rebuild', 'index'))
         AND (reason IS NULL OR (kind, reason) IN (('full-rebuild', 'first-sync'), ('full-rebuild', 'model-choice-change'), ('full-rebuild', 'reconciler'), ('full-rebuild', 'erasure'), ('full-rebuild', 'upgrade'), ('full-rebuild', 'drill'), ('index', 'bound'), ('index', 'restored'), ('index', 'dismissed'), ('index', 'rule-change'), ('index', 'wiped'))));--> statement-breakpoint
-- Every pending migration runs in one transaction, so the bound ends with this one.
SET LOCAL lock_timeout = DEFAULT;
