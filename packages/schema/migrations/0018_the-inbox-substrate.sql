-- Custom migration (hand-written SQL; ADR 0031, ADR 0032).
-- The inbox's substrate: the FORCE line withRLS() cannot emit, the privileges that make
-- "nothing reads a payload but the acceptance path" the database's sentence rather than a
-- convention, and the three concept-inbox SQL functions both tiers call (ADR 0031).

-- FORCE applies RLS to the table's owner too (ADR 0032); the coverage test fails on any
-- tenant table whose FORCE line is missing.
ALTER TABLE "suggestion" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "concept_write_request" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- **The payload is out of every runtime role's reach.** A `concept_write_request` is
-- platform state in no knowledge layer, and nothing reads one but the acceptance path
-- (ADR 0012's 2026-09-01 amendment) — which means, in particular, that no enrichment run
-- may read another run's candidates out of the inbox. Migration 0000's default privileges
-- would have granted both runtime roles DML on it; they are taken back here, and the two
-- functions below are the only way in. Proved by "refuses both runtime roles the payload
-- table itself, and serves it only through the definer function (migration 0018)" in
-- packages/schema/test/rls.test.ts.
REVOKE ALL ON "concept_write_request" FROM app_rt, worker_rt;
--> statement-breakpoint
-- The worker submits through the function below and reads nothing back: the queue is the
-- app's, and a producer that could read it could read another producer's work.
REVOKE ALL ON "suggestion" FROM worker_rt;
--> statement-breakpoint
-- A decided suggestion is a fact — "a declined suggestion is recorded with its reason"
-- (ADR 0012), and a record that can be deleted is a silence waiting to happen. The app
-- writes a decision as an UPDATE and never as a DELETE, so DELETE goes.
REVOKE DELETE ON "suggestion" FROM app_rt;
--> statement-breakpoint
-- concept-inbox (ADR 0031): **submitting a suggestion set is one function call**, and the
-- transition is the database's rather than two clients' agreeing interpretation of it.
--
-- It takes no workspace argument at all: the set lands in the workspace the caller's
-- transaction is already scoped to, so a producer cannot name another tenant's inbox even
-- by mistake: the guard a definer function's arguments have to carry against the
-- transaction's scope is made unnecessary by there being no such argument. search_path is
-- pinned and every object is schema-qualified, because the pinned path cannot see `public`.
--
-- Two statements rather than one, so the payload's foreign key is checked against a
-- suggestion row that already exists rather than against one written by the same command.
CREATE FUNCTION submit_suggestion_set(
  p_set_id text, p_kind text, p_proposer text, p_requests jsonb
) RETURNS SETOF text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_workspace text := nullif(current_setting('app.workspace_id', true), '');
BEGIN
  IF v_workspace IS NULL THEN
    RAISE EXCEPTION 'submit_suggestion_set: the transaction is scoped to no workspace'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- A set is bounded by what an Admin could decide (SUGGESTION_SET_MAX in
  -- src/suggestion-tables.ts): a producer chooses how much it sends, so somebody other
  -- than the sender has to choose the ceiling.
  IF jsonb_typeof(p_requests) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_requests) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'submit_suggestion_set: a set carries between one and 500 requests'
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
  SELECT v_workspace, r.suggestion_id, r.merge_key, r.path, r.concept_kind, r.title,
         r.frontmatter, r.body, r.base_content_hash
    FROM jsonb_to_recordset(p_requests)
      AS r(suggestion_id text, merge_key text, path text, concept_kind text, title text,
           frontmatter jsonb, body text, base_content_hash text)
  RETURNING suggestion_id;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION submit_suggestion_set(text, text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
-- Both tiers submit: a person's *edit* through the app, a run's candidates through the
-- worker. That is what makes this an agreement rather than one tier's helper (ADR 0031).
GRANT EXECUTE ON FUNCTION submit_suggestion_set(text, text, text, jsonb) TO app_rt, worker_rt;
--> statement-breakpoint
-- **The set's summary, re-rendered against `concept_identity` every time it is asked for.**
-- The resolution is a join and never a stored column, so an Admin decides against the map of
-- today rather than the map of the proposal's day; `base_moved` is the payload's own
-- precondition read the same way, so the summary says which items an acceptance would refuse
-- before anybody clicks. A read writes no row, which is why the resolution is
-- returned rather than stamped onto the suggestion.
--
-- Definer, because the payload table is out of the app's reach; the workspace guard is the
-- WHERE clause, which resolves to NULL and so to zero rows when the transaction names no
-- workspace.
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
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION suggestion_set_summary(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION suggestion_set_summary(text) TO app_rt;
--> statement-breakpoint
-- **The payload, for the acceptance path and nothing else.** Granted to the app's role
-- alone, and only for a suggestion that is still waiting: a decided one has been committed
-- or refused, and its payload has no reader left.
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
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION concept_write_request_for(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION concept_write_request_for(text) TO app_rt;
