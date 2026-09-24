ALTER TABLE "suppression" DROP CONSTRAINT "suppression_document_fk";--> statement-breakpoint
DROP INDEX "suppression_workspace_id_document_id_idx";--> statement-breakpoint
ALTER TABLE "suppression" DROP CONSTRAINT "suppression_workspace_id_erasure_request_id_document_id_pk";--> statement-breakpoint
-- Row-level security binds the owner, so this takes each workspace's scope. Every row of a
-- request holds the request's set, so any one may stand.
DO $$
DECLARE
  scope text;
BEGIN
  FOR scope IN SELECT id FROM public.workspace LOOP
    PERFORM set_config('app.workspace_id', scope, true);
    DELETE FROM public.suppression AS later
     USING public.suppression AS kept
     WHERE kept.workspace_id = later.workspace_id
       AND kept.erasure_request_id = later.erasure_request_id
       AND kept.document_id < later.document_id;
  END LOOP;
  PERFORM set_config('app.workspace_id', '', true);
END $$;--> statement-breakpoint
ALTER TABLE "suppression" DROP COLUMN "document_id";--> statement-breakpoint
ALTER TABLE "suppression" ADD CONSTRAINT "suppression_workspace_id_erasure_request_id_pk" PRIMARY KEY("workspace_id","erasure_request_id");--> statement-breakpoint
-- An erasure completed while the documents finder found nothing wrote no row, and its person stays
-- in every document until one is written.
DO $$
DECLARE
  scope text;
BEGIN
  FOR scope IN SELECT id FROM public.workspace LOOP
    PERFORM set_config('app.workspace_id', scope, true);
    INSERT INTO public.suppression (workspace_id, erasure_request_id, identifiers)
    SELECT erasure.workspace_id, erasure.id, request.identifiers
      FROM public.erasure_request AS erasure
      JOIN public.subject_request AS request
        ON request.workspace_id = erasure.workspace_id
       AND request.id = erasure.subject_request_id
     WHERE erasure.completed_at IS NOT NULL
       AND jsonb_array_length(request.identifiers -> 'emails')
         + jsonb_array_length(request.identifiers -> 'names')
         + jsonb_array_length(request.identifiers -> 'other') > 0
    ON CONFLICT (workspace_id, erasure_request_id) DO NOTHING;
  END LOOP;
  PERFORM set_config('app.workspace_id', '', true);
END $$;
