-- Custom migration (hand-written SQL; ADR 0032).

CREATE OR REPLACE FUNCTION public.suggestion_decides_once() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_erased_as text := nullif(current_setting('app.erasing_suggestions_as', true), '');
  v_run_by_the_erasure_definer boolean :=
    current_user = (SELECT pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid = TG_RELID);
BEGIN
  IF v_erased_as IS NOT NULL AND v_run_by_the_erasure_definer THEN
    IF (NEW.workspace_id, NEW.id, NEW.set_id, NEW.kind, NEW.status, NEW.target_iri,
        NEW.proposed_at, NEW.decided_at)
       IS DISTINCT FROM
       (OLD.workspace_id, OLD.id, OLD.set_id, OLD.kind, OLD.status, OLD.target_iri,
        OLD.proposed_at, OLD.decided_at)
       OR (NEW.proposer IS DISTINCT FROM OLD.proposer AND NEW.proposer <> v_erased_as)
       OR (NEW.decider IS DISTINCT FROM OLD.decider AND NEW.decider IS DISTINCT FROM v_erased_as) THEN
      RAISE EXCEPTION 'suggestion %: an erasure rewrites who proposed and decided, and nothing else',
        OLD.id USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'waiting' THEN
    RAISE EXCEPTION 'suggestion %: decided as % already, and a decision is never rewritten',
      OLD.id, OLD.status USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status = 'waiting' THEN
    RAISE EXCEPTION 'suggestion %: an update to a waiting suggestion decides it', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF nullif(current_setting('app.deciding_suggestion', true), '') IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'suggestion %: a decision is the concepts slice''s act, and this transaction is not making it',
      OLD.id USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW.workspace_id, NEW.id, NEW.set_id, NEW.kind, NEW.proposer, NEW.proposed_at)
     IS DISTINCT FROM
     (OLD.workspace_id, OLD.id, OLD.set_id, OLD.kind, OLD.proposer, OLD.proposed_at) THEN
    RAISE EXCEPTION 'suggestion %: a decision decides, and never restates what was proposed',
      OLD.id USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE FUNCTION public.erasure_needle_pattern(p_actors text[], p_addresses text[])
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT '(' || string_agg(regexp_replace(n, '([^[:alnum:]])', '\\\1', 'g'), '|') || ')'
    FROM unnest(p_actors || ARRAY(SELECT 'human:' || a FROM unnest(p_addresses) AS a)) AS n
   WHERE n <> '' AND n <> 'human:'
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.erasure_needle_pattern(text[], text[]) FROM PUBLIC;--> statement-breakpoint
CREATE FUNCTION public.concept_write_requests_naming(p_actors text[], p_addresses text[])
RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT r.suggestion_id
    FROM public.concept_write_request r,
         public.erasure_needle_pattern(p_actors, p_addresses) AS p(pattern)
   WHERE r.workspace_id = (SELECT public.current_workspace_id())
     AND p.pattern IS NOT NULL
     AND (r.title ~* p.pattern OR r.frontmatter::text ~* p.pattern OR r.body ~* p.pattern)
   ORDER BY r.suggestion_id
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.concept_write_requests_naming(text[], text[]) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.concept_write_requests_naming(text[], text[]) TO app_rt;--> statement-breakpoint
CREATE FUNCTION public.erase_from_the_suggestions(
  p_workspace_id text, p_actors text[], p_addresses text[], p_erased_as text
) RETURNS TABLE (suggestions integer, requests integer)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_scope text := (SELECT public.current_workspace_id());
  v_pattern text := public.erasure_needle_pattern(p_actors, p_addresses);
  v_suggestions integer;
  v_requests integer;
BEGIN
  IF v_scope IS NULL OR p_workspace_id IS DISTINCT FROM v_scope THEN
    RAISE EXCEPTION 'erase_from_the_suggestions: the transaction is scoped to another workspace'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_erased_as IS NULL OR p_erased_as !~ '^human:[0-9A-HJKMNP-TV-Z]{26}$' THEN
    RAISE EXCEPTION 'erase_from_the_suggestions: the pseudonym actor is not an actor id'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM set_config('app.erasing_suggestions_as', p_erased_as, true);
  UPDATE public.suggestion s
     SET proposer = CASE WHEN s.proposer = ANY (p_actors) THEN p_erased_as ELSE s.proposer END,
         decider = CASE WHEN s.decider = ANY (p_actors) THEN p_erased_as ELSE s.decider END,
         reason = CASE WHEN s.decider = ANY (p_actors) AND s.reason IS NOT NULL
                       THEN 'Removed when its author''s personal data was erased.'
                       ELSE s.reason END
   WHERE s.workspace_id = p_workspace_id
     AND (s.proposer = ANY (p_actors) OR s.decider = ANY (p_actors));
  GET DIAGNOSTICS v_suggestions = ROW_COUNT;
  PERFORM set_config('app.erasing_suggestions_as', '', true);

  UPDATE public.concept_write_request r
     SET title = regexp_replace(r.title, v_pattern, p_erased_as, 'gi'),
         frontmatter = regexp_replace(r.frontmatter::text, v_pattern, p_erased_as, 'gi')::jsonb,
         body = regexp_replace(r.body, v_pattern, p_erased_as, 'gi')
   WHERE r.workspace_id = p_workspace_id
     AND v_pattern IS NOT NULL
     AND (r.title ~* v_pattern OR r.frontmatter::text ~* v_pattern OR r.body ~* v_pattern);
  GET DIAGNOSTICS v_requests = ROW_COUNT;

  RETURN QUERY SELECT v_suggestions, v_requests;
END $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.erase_from_the_suggestions(text, text[], text[], text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.erase_from_the_suggestions(text, text[], text[], text) TO app_rt;
