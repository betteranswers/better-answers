-- Custom migration (hand-written SQL; ADR 0032).

ALTER TABLE "suggestion" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "concept_write_request" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "concept_write_request" FROM app_rt, worker_rt;--> statement-breakpoint
REVOKE ALL ON "suggestion" FROM worker_rt;--> statement-breakpoint
REVOKE DELETE ON "suggestion" FROM app_rt;--> statement-breakpoint
CREATE FUNCTION suggestion_decides_once() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
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
  -- What the suggestion *is* — whose it is, which set it arrived in, what kind of change
  -- it proposes and when it was raised — is the proposer's, and a decision only decides.
  IF (NEW.workspace_id, NEW.id, NEW.set_id, NEW.kind, NEW.proposer, NEW.proposed_at)
     IS DISTINCT FROM
     (OLD.workspace_id, OLD.id, OLD.set_id, OLD.kind, OLD.proposer, OLD.proposed_at) THEN
    RAISE EXCEPTION 'suggestion %: a decision decides, and never restates what was proposed',
      OLD.id USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER suggestion_decides_once_trigger
BEFORE UPDATE ON "suggestion" FOR EACH ROW EXECUTE FUNCTION suggestion_decides_once();--> statement-breakpoint
CREATE FUNCTION submit_suggestion_set(
  p_set_id text, p_kind text, p_proposer text, p_requests jsonb
) RETURNS SETOF text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_workspace text := nullif(current_setting('app.workspace_id', true), '');
  -- **Which tier is calling**, read past SECURITY DEFINER, which replaces `current_user`
  -- with this function's owner and so cannot answer it. The `role` GUC holds what the
  -- caller last `SET ROLE`'d to and is *not* pushed aside by the definer context — it reads
  -- `none` when nobody set one, and then the caller is whoever logged in, which is how the
  -- estate connects (each tier logs in as its own runtime role).
  v_caller text := coalesce(nullif(current_setting('role', true), 'none'), session_user);
  -- The kinds each tier may raise (SUGGESTION_KINDS_FROM_THE_APP and
  -- SUGGESTION_KINDS_FROM_A_RUN in src/suggestion-tables.ts, which say why each list is
  -- what it is). Held here because `p_kind` and `p_proposer` are both the caller's words: a
  -- compromised worker could otherwise submit an *edit* under a `human:` proposer — a form
  -- the row's CHECK accepts — and put a change in a person's name into the queue an Admin
  -- decides from, and a compromised app could raise a run's *candidate* nobody ran.
  v_permitted text[] := CASE v_caller
    WHEN 'app_rt' THEN ARRAY['edit', 'promotion']
    WHEN 'worker_rt' THEN ARRAY['candidate', 'promotion', 'repair']
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
  -- A set is bounded by what an Admin could decide (SUGGESTION_SET_MAX in
  -- src/suggestion-tables.ts): a producer chooses how much it sends, so somebody other
  -- than the producer has to choose the ceiling.
  IF jsonb_typeof(p_requests) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_requests) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'submit_suggestion_set: a set carries between one and 500 requests'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- **A frontmatter arrives as the producer's own JSON text, is a JSON object, and is bounded
  -- as the producer wrote it** (CONCEPT_FRONTMATTER_MAX in src/concept-tables.ts). It is sent
  -- as a string rather than as an object so that this function measures the same characters
  -- the boundary measured: a `jsonb` value read back with `::text` is Postgres's rendering
  -- of it, not the producer's, and the two are not within any multiplier of each other —
  -- `{"a":1e-100}` is twelve characters sent and a hundred and nine read back, and a
  -- number may carry a scale of sixteen thousand. A bound over the rendering would
  -- therefore refuse payloads the boundary had already passed, which is the one thing a
  -- backstop must never do. This is the *only* road to the row (both runtime roles hold
  -- REVOKE ALL on the table), so one measurement here is the whole bound.
  --
  -- The object test is the same guard's third arm rather than a later surprise: a payload
  -- is the file an acceptance would commit and the write path reads its keys, so a JSON
  -- null, a list or a bare scalar casts and stores perfectly well and then fails at the
  -- acceptance, where the refusal is somebody else's problem. The CASE is what keeps the
  -- cast from being reached for text that is not JSON at all, which Postgres refuses in its
  -- own words and code.
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

  -- The proposer's *form*, and the kind a form may raise, are the row's own CHECKs
  -- (`suggestion_proposer_check`, `suggestion_repair_proposer_check`): held where a
  -- compromised producer calling this function cannot argue with them.
  INSERT INTO public.suggestion (workspace_id, id, set_id, kind, proposer)
  SELECT v_workspace, r.suggestion_id, p_set_id, p_kind, p_proposer
    FROM jsonb_to_recordset(p_requests) AS r(suggestion_id text);

  RETURN QUERY
  INSERT INTO public.concept_write_request
         (workspace_id, suggestion_id, merge_key, path, concept_kind, title, frontmatter,
          body, base_content_hash)
  -- The cast is here and after the bound above, so what was measured is what is stored.
  SELECT v_workspace, r.suggestion_id, r.merge_key, r.path, r.concept_kind, r.title,
         r.frontmatter::jsonb, r.body, r.base_content_hash
    FROM jsonb_to_recordset(p_requests)
      AS r(suggestion_id text, merge_key text, path text, concept_kind text, title text,
           frontmatter text, body text, base_content_hash text)
  RETURNING suggestion_id;
END $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION submit_suggestion_set(text, text, text, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION submit_suggestion_set(text, text, text, jsonb) TO app_rt, worker_rt;--> statement-breakpoint
CREATE FUNCTION suggestion_set_summary(p_set_id text)
RETURNS TABLE (
  suggestion_id text, kind text, status text, proposer text, decider text, reason text,
  merge_key text, title text, path text, resolved_iri text, base_content_hash text,
  base_moved boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT s.id, s.kind, s.status, s.proposer, s.decider, s.reason,
         r.merge_key, r.title, r.path, i.iri, r.base_content_hash,
         r.base_content_hash IS NOT NULL AND r.base_content_hash IS DISTINCT FROM c.content_hash
    FROM public.suggestion s
    JOIN public.concept_write_request r
      ON r.workspace_id = s.workspace_id AND r.suggestion_id = s.id
    LEFT JOIN public.concept_identity i
      ON i.workspace_id = s.workspace_id AND i.merge_key = r.merge_key
    LEFT JOIN public.concept_index c
      ON c.workspace_id = i.workspace_id AND c.iri = i.iri
   WHERE s.workspace_id = (SELECT public.current_workspace_id())
     AND s.set_id = p_set_id
   ORDER BY s.id
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION suggestion_set_summary(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION suggestion_set_summary(text) TO app_rt;--> statement-breakpoint
CREATE FUNCTION concept_write_request_for(p_suggestion_id text)
RETURNS TABLE (
  merge_key text, path text, concept_kind text, title text, frontmatter jsonb, body text,
  base_content_hash text, set_id text, kind text, proposer text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT r.merge_key, r.path, r.concept_kind, r.title, r.frontmatter, r.body,
         r.base_content_hash, s.set_id, s.kind, s.proposer
    FROM public.concept_write_request r
    JOIN public.suggestion s
      ON s.workspace_id = r.workspace_id AND s.id = r.suggestion_id
   WHERE r.workspace_id = (SELECT public.current_workspace_id())
     AND r.suggestion_id = p_suggestion_id
     AND s.status = 'waiting'
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION concept_write_request_for(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION concept_write_request_for(text) TO app_rt;
