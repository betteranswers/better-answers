-- Custom migration (hand-written SQL; ADR 0032).
-- A concept's kind is its type (ADR 0026). A column rename rewrites no rows; Postgres carries the
-- generated `search` column, the index and the CHECK across, and only the function bodies, which
-- are text, are written again.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "concept_index" RENAME COLUMN "kind" TO "concept_type";--> statement-breakpoint
ALTER TABLE "concept_index" RENAME CONSTRAINT "concept_index_kind_not_null" TO "concept_index_concept_type_not_null";--> statement-breakpoint
ALTER TABLE "concept_write_request" RENAME COLUMN "concept_kind" TO "concept_type";--> statement-breakpoint
ALTER TABLE "concept_write_request" RENAME CONSTRAINT "concept_write_request_concept_kind_not_null" TO "concept_write_request_concept_type_not_null";--> statement-breakpoint
ALTER TABLE "guide_definition" RENAME COLUMN "kind" TO "guide_type";--> statement-breakpoint
ALTER TABLE "guide_definition" RENAME CONSTRAINT "guide_definition_kind_not_null" TO "guide_definition_guide_type_not_null";--> statement-breakpoint
ALTER TABLE "guide_expected_fact" RENAME COLUMN "kind" TO "concept_type";--> statement-breakpoint
ALTER TABLE "guide_expected_fact" RENAME CONSTRAINT "guide_expected_fact_kind_not_null" TO "guide_expected_fact_concept_type_not_null";--> statement-breakpoint
ALTER TABLE "map_node" RENAME COLUMN "kind" TO "concept_type";--> statement-breakpoint
ALTER INDEX "map_node_kind_idx" RENAME TO "map_node_concept_type_idx";--> statement-breakpoint
ALTER TABLE "map_edge" RENAME COLUMN "from_kind" TO "from_concept_type";--> statement-breakpoint
ALTER TABLE "map_edge" RENAME COLUMN "to_kind" TO "to_concept_type";--> statement-breakpoint
-- CREATE OR REPLACE cannot rename an OUT column, so the function is created again with 0018's grants.
DROP FUNCTION public.concept_write_request_for(text);--> statement-breakpoint
CREATE FUNCTION public.concept_write_request_for(p_suggestion_id text)
RETURNS TABLE (
  merge_key text, path text, concept_type text, title text, frontmatter jsonb, body text,
  base_content_hash text, set_id text, kind text, proposer text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT r.merge_key, r.path, r.concept_type, r.title, r.frontmatter, r.body,
         r.base_content_hash, s.set_id, s.kind, s.proposer
    FROM public.concept_write_request r
    JOIN public.suggestion s
      ON s.workspace_id = r.workspace_id AND s.id = r.suggestion_id
   WHERE r.workspace_id = (SELECT public.current_workspace_id())
     AND r.suggestion_id = p_suggestion_id
     AND s.status = 'waiting'
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.concept_write_request_for(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.concept_write_request_for(text) TO app_rt;--> statement-breakpoint
-- The requests' key is renamed with the column; CREATE OR REPLACE keeps 0018's grants.
CREATE OR REPLACE FUNCTION public.submit_suggestion_set(
  p_set_id text, p_kind text, p_proposer text, p_requests jsonb
) RETURNS SETOF text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_workspace text := nullif(current_setting('app.workspace_id', true), '');
  -- The calling tier, read past SECURITY DEFINER; 0018 says why the role GUC answers it.
  v_caller text := coalesce(nullif(current_setting('role', true), 'none'), session_user);
  -- SUGGESTION_KINDS_FROM_THE_APP and SUGGESTION_KINDS_FROM_A_RUN in src/suggestion-tables.ts.
  v_permitted text[] := CASE v_caller
    WHEN 'app_rt' THEN ARRAY['edit', 'promotion']
    WHEN 'worker_rt' THEN ARRAY['suggested-concept', 'promotion', 'citation-fix']
  END;
BEGIN
  IF v_workspace IS NULL THEN
    RAISE EXCEPTION 'submit_suggestion_set: the transaction is scoped to no workspace'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_permitted IS NULL OR NOT (p_kind = ANY (v_permitted)) THEN
    RAISE EXCEPTION 'submit_suggestion_set: % may not raise a suggestion of kind %',
      v_caller, p_kind USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- SUGGESTION_SET_MAX in src/suggestion-tables.ts.
  IF jsonb_typeof(p_requests) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_requests) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'submit_suggestion_set: a set carries between one and 500 requests'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- CONCEPT_FRONTMATTER_MAX in src/concept-tables.ts, measured on the producer's own text (0018).
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_requests) AS e
     WHERE jsonb_typeof(e -> 'frontmatter') IS DISTINCT FROM 'string'
        OR char_length(e ->> 'frontmatter') > 64000
        OR CASE WHEN pg_input_is_valid(e ->> 'frontmatter', 'jsonb')
                THEN jsonb_typeof((e ->> 'frontmatter')::jsonb) END IS DISTINCT FROM 'object'
  ) THEN
    RAISE EXCEPTION 'submit_suggestion_set: a frontmatter is the producer''s own JSON text, a JSON object of at most 64000 characters'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO public.suggestion (workspace_id, id, set_id, kind, proposer)
  SELECT v_workspace, r.suggestion_id, p_set_id, p_kind, p_proposer
    FROM jsonb_to_recordset(p_requests) AS r(suggestion_id text);

  RETURN QUERY
  INSERT INTO public.concept_write_request
         (workspace_id, suggestion_id, merge_key, path, concept_type, title, frontmatter,
          body, base_content_hash)
  SELECT v_workspace, r.suggestion_id, r.merge_key, r.path, r.concept_type, r.title,
         r.frontmatter::jsonb, r.body, r.base_content_hash
    FROM jsonb_to_recordset(p_requests)
      AS r(suggestion_id text, merge_key text, path text, concept_type text, title text,
           frontmatter text, body text, base_content_hash text)
  RETURNING suggestion_id;
END $$;--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
