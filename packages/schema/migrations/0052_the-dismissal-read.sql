-- Custom migration (hand-written SQL; ADR 0032).
GRANT SELECT (review_state) ON "finding" TO worker_rt;--> statement-breakpoint
-- A table-wide UPDATE would reach `narrowed_to`, and a run that could write the Admin's narrowing
-- could lift it.
REVOKE UPDATE ON "source_document" FROM worker_rt;--> statement-breakpoint
GRANT UPDATE (content_hash, normalised_key, redaction_version, outcome, quarantine_error,
              last_seen, sensitivity)
  ON "source_document" TO worker_rt;--> statement-breakpoint
-- Row-level security is forced on the owner, so the backfill takes each workspace's scope. A
-- narrowing only narrows, so the last is the one.
DO $$
DECLARE
  scope text;
BEGIN
  FOR scope IN SELECT id FROM public.workspace LOOP
    PERFORM set_config('app.workspace_id', scope, true);
    UPDATE public.source_document AS d
       SET narrowed_to = last_narrowing.sensitivity
      FROM (SELECT DISTINCT ON (subject_id) subject_id, detail ->> 'sensitivity' AS sensitivity
              FROM public.audit_event
             WHERE act = 'sources.document.narrowed'
             ORDER BY subject_id, id DESC) AS last_narrowing
     WHERE d.id = last_narrowing.subject_id;
  END LOOP;
  PERFORM set_config('app.workspace_id', '', true);
END $$;
