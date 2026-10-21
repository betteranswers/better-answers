-- Custom migration (hand-written SQL; ADR 0032).

-- The erasure rewrites suggestions, decided ones included, which this trigger otherwise
-- refuses. It does so only as the table's owner, inside `erase_from_the_suggestions`, which sets
-- `app.erasing_suggestions_as` to the pseudonym actor for its one UPDATE and clears it
-- after. The api runs as `app_rt`, never as the owner, so setting the GUC itself buys it
-- nothing. In that branch the update may change only the proposer and decider, each to the
-- pseudonym actor, and the reason, to the erasure's sentence.
CREATE OR REPLACE FUNCTION public.suggestion_decides_once() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_erased_as text := nullif(current_setting('app.erasing_suggestions_as', true), '');
  v_as_the_table_owner boolean :=
    current_user = (SELECT pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid = TG_RELID);
  v_erased_reason CONSTANT text := 'Removed when its author''s personal data was erased.';
  v_only_the_names_change boolean;
  v_restates_the_proposal boolean;
BEGIN
  IF v_erased_as IS NOT NULL AND v_as_the_table_owner THEN
    v_only_the_names_change :=
      (to_jsonb(NEW) - 'proposer' - 'decider' - 'reason')
        = (to_jsonb(OLD) - 'proposer' - 'decider' - 'reason')
      AND (NEW.proposer IS NOT DISTINCT FROM OLD.proposer OR NEW.proposer IS NOT DISTINCT FROM v_erased_as)
      AND (NEW.decider IS NOT DISTINCT FROM OLD.decider OR NEW.decider IS NOT DISTINCT FROM v_erased_as)
      AND (NEW.reason IS NOT DISTINCT FROM OLD.reason OR NEW.reason IS NOT DISTINCT FROM v_erased_reason);
    IF NOT v_only_the_names_change THEN
      RAISE EXCEPTION 'suggestion %: an erasure rewrites who proposed and decided to its pseudonym, and the reason to its sentence, and nothing else',
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
  v_restates_the_proposal :=
    (NEW.workspace_id, NEW.id, NEW.set_id, NEW.kind, NEW.proposer, NEW.proposed_at)
    IS DISTINCT FROM
    (OLD.workspace_id, OLD.id, OLD.set_id, OLD.kind, OLD.proposer, OLD.proposed_at);
  IF v_restates_the_proposal THEN
    RAISE EXCEPTION 'suggestion %: a decision decides, and never restates what was proposed',
      OLD.id USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
-- The erasers and the finder take their needles from the api, so a compromised api must not
-- turn them into a match or rewrite of arbitrary text. This is the one place a needle is formed: a person is a
-- person id, an address is address-shaped, and each becomes `human:<it>`. The lookahead
-- stops `human:a@b.co` matching inside `human:a@b.com`. Only the definers call it, so
-- EXECUTE is revoked from PUBLIC and granted to nobody.
CREATE FUNCTION public.erasure_needle_pattern(p_people text[], p_addresses text[])
RETURNS text
LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM unnest(p_people) AS p WHERE p IS NULL OR p !~ '^[0-9A-HJKMNP-TV-Z]{26}$') THEN
    RAISE EXCEPTION 'erasure: a person is named by their person id'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_addresses) AS a
     WHERE a IS NULL OR char_length(a) > 254
        OR a !~ '^[a-z0-9_''+.-]+@([a-z0-9][a-z0-9-]*\.)+[a-z]{2,}$'
  ) THEN
    RAISE EXCEPTION 'erasure: an address is a lower-case email address'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN (
    SELECT 'human:(' || string_agg(regexp_replace(n, '([^[:alnum:]])', '\\\1', 'g'), '|')
           || ')(?![[:alnum:]_%+-]|\.[[:alnum:]])'
      FROM unnest(p_people || p_addresses) AS n
  );
END $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.erasure_needle_pattern(text[], text[]) FROM PUBLIC;--> statement-breakpoint
CREATE FUNCTION public.write_request_names(p_request public.concept_write_request, p_pattern text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p_pattern IS NOT NULL
     AND (p_request.title ~* p_pattern
          OR p_request.frontmatter::text ~* p_pattern
          OR p_request.body ~* p_pattern)
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.write_request_names(public.concept_write_request, text) FROM PUBLIC;--> statement-breakpoint
-- A pseudonym is one the routine minted for an erasure in this workspace. The row may be
-- completed: a rerun after a restore sweeps again under the same pseudonym. `app_rt` can
-- write `erasure_request`, so this binds the pseudonym to a recorded erasure; it cannot
-- prove the needles are that erasure's subject.
CREATE FUNCTION public.erasure_scope_check(p_workspace_id text, p_pseudonym text)
RETURNS void
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_scope text := (SELECT public.current_workspace_id());
BEGIN
  IF v_scope IS NULL OR p_workspace_id IS DISTINCT FROM v_scope THEN
    RAISE EXCEPTION 'erasure: the transaction is scoped to another workspace'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_pseudonym IS NULL OR p_pseudonym !~ '^[0-9A-HJKMNP-TV-Z]{26}$' OR NOT EXISTS (
    SELECT 1 FROM public.erasure_request e
     WHERE e.workspace_id = v_scope AND e.pseudonym = p_pseudonym
  ) THEN
    RAISE EXCEPTION 'erasure: no erasure in this workspace minted that pseudonym'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
END $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.erasure_scope_check(text, text) FROM PUBLIC;--> statement-breakpoint
-- The finder and the write-request eraser share `write_request_names`, so the map lists
-- exactly the requests the eraser rewrites, whatever their suggestion's status.
CREATE FUNCTION public.concept_write_requests_naming(p_people text[], p_addresses text[])
RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT r.suggestion_id
    FROM public.concept_write_request r,
         public.erasure_needle_pattern(p_people, p_addresses) AS p(pattern)
   WHERE r.workspace_id = (SELECT public.current_workspace_id())
     AND public.write_request_names(r, p.pattern)
   ORDER BY r.suggestion_id
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.concept_write_requests_naming(text[], text[]) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.concept_write_requests_naming(text[], text[]) TO app_rt;--> statement-breakpoint
CREATE FUNCTION public.erase_from_the_suggestions(
  p_workspace_id text, p_people text[], p_pseudonym text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actors text[];
  v_erased_as text := 'human:' || p_pseudonym;
  v_rewritten integer;
BEGIN
  PERFORM public.erasure_scope_check(p_workspace_id, p_pseudonym);
  PERFORM public.erasure_needle_pattern(p_people, ARRAY[]::text[]);
  v_actors := ARRAY(SELECT 'human:' || p FROM unnest(p_people) AS p);

  PERFORM set_config('app.erasing_suggestions_as', v_erased_as, true);
  UPDATE public.suggestion s
     SET proposer = CASE WHEN s.proposer = ANY (v_actors) THEN v_erased_as ELSE s.proposer END,
         decider = CASE WHEN s.decider = ANY (v_actors) THEN v_erased_as ELSE s.decider END,
         reason = CASE WHEN s.decider = ANY (v_actors) AND s.reason IS NOT NULL
                       THEN 'Removed when its author''s personal data was erased.'
                       ELSE s.reason END
   WHERE s.workspace_id = p_workspace_id
     AND (s.proposer = ANY (v_actors) OR s.decider = ANY (v_actors));
  GET DIAGNOSTICS v_rewritten = ROW_COUNT;
  PERFORM set_config('app.erasing_suggestions_as', '', true);
  RETURN v_rewritten;
END $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.erase_from_the_suggestions(text, text[], text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.erase_from_the_suggestions(text, text[], text) TO app_rt;--> statement-breakpoint
-- A pseudonym actor is 32 characters, longer than many needles, so a body near
-- `concept_write_request_body_length_check` can outgrow it. Such a body is replaced by the
-- sentence below, never cut, and a waiting suggestion it belongs to is returned with that
-- sentence as its reason, by the decision path, so no Admin accepts a body the erasure
-- removed. `bodies_replaced` counts them for the report.
CREATE FUNCTION public.erase_from_the_write_requests(
  p_workspace_id text, p_people text[], p_addresses text[], p_pseudonym text
) RETURNS TABLE (rewritten integer, bodies_replaced integer)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_pattern text;
  v_erased_as text := 'human:' || p_pseudonym;
  v_too_long CONSTANT text :=
    'Removed: erasing a person''s personal data from this request made it longer than a request may be.';
  v_replaced text[];
  v_id text;
BEGIN
  PERFORM public.erasure_scope_check(p_workspace_id, p_pseudonym);
  v_pattern := public.erasure_needle_pattern(p_people, p_addresses);

  WITH named AS (
    SELECT r.suggestion_id,
           regexp_replace(r.title, v_pattern, v_erased_as, 'gi') AS title,
           regexp_replace(r.frontmatter::text, v_pattern, v_erased_as, 'gi')::jsonb AS frontmatter,
           regexp_replace(r.body, v_pattern, v_erased_as, 'gi') AS body
      FROM public.concept_write_request r
     WHERE r.workspace_id = p_workspace_id
       AND public.write_request_names(r, v_pattern)
  ), updated AS (
    UPDATE public.concept_write_request r
       SET title = n.title,
           frontmatter = n.frontmatter,
           body = CASE WHEN char_length(n.body) <= 100000 THEN n.body ELSE v_too_long END
      FROM named n
     WHERE r.workspace_id = p_workspace_id AND r.suggestion_id = n.suggestion_id
    RETURNING r.suggestion_id, char_length(n.body) > 100000 AS replaced
  )
  SELECT count(*)::integer, ARRAY(SELECT u.suggestion_id FROM updated u WHERE u.replaced)
    INTO rewritten, v_replaced
    FROM updated;
  bodies_replaced := cardinality(v_replaced);

  FOR v_id IN
    SELECT s.id FROM public.suggestion s
     WHERE s.workspace_id = p_workspace_id AND s.id = ANY (v_replaced) AND s.status = 'waiting'
  LOOP
    PERFORM set_config('app.deciding_suggestion', v_id, true);
    UPDATE public.suggestion
       SET status = 'returned', decider = 'process:better-answers-erasure', decided_at = now(),
           reason = v_too_long
     WHERE workspace_id = p_workspace_id AND id = v_id;
  END LOOP;
  PERFORM set_config('app.deciding_suggestion', '', true);
  RETURN NEXT;
END $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.erase_from_the_write_requests(text, text[], text[], text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.erase_from_the_write_requests(text, text[], text[], text) TO app_rt;
