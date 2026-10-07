-- Custom migration (hand-written SQL; ADR 0032).
-- The knowledge words take the reader's names: a composition is a write-up, a class override is a
-- sensitivity override, a quarantined document is unreadable, a candidate concept is a suggested
-- concept and a citation repair is a citation fix. Three tables, a column, a function and five stored
-- values are renamed, and submit_suggestion_set is replaced for the kinds it names. A rename takes an
-- ACCESS EXCLUSIVE lock; five seconds bounds the wait behind a reader, and a failed release is
-- re-run by hand.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "composition" RENAME TO "write_up";--> statement-breakpoint
ALTER TABLE "write_up" RENAME CONSTRAINT "composition_workspace_id_id_pk" TO "write_up_workspace_id_id_pk";--> statement-breakpoint
ALTER TABLE "write_up" RENAME CONSTRAINT "composition_workspace_id_workspace_id_fk" TO "write_up_workspace_id_workspace_id_fk";--> statement-breakpoint
ALTER TABLE "write_up" RENAME CONSTRAINT "composition_audience_check" TO "write_up_audience_check";--> statement-breakpoint
ALTER TABLE "write_up" RENAME CONSTRAINT "composition_sensitivity_check" TO "write_up_sensitivity_check";--> statement-breakpoint
ALTER TABLE "write_up" RENAME CONSTRAINT "composition_workspace_id_not_null" TO "write_up_workspace_id_not_null";--> statement-breakpoint
ALTER TABLE "write_up" RENAME CONSTRAINT "composition_id_not_null" TO "write_up_id_not_null";--> statement-breakpoint
ALTER TABLE "write_up" RENAME CONSTRAINT "composition_sensitivity_not_null" TO "write_up_sensitivity_not_null";--> statement-breakpoint
ALTER TABLE "write_up" RENAME CONSTRAINT "composition_audience_not_null" TO "write_up_audience_not_null";--> statement-breakpoint
ALTER TABLE "write_up" RENAME CONSTRAINT "composition_created_at_not_null" TO "write_up_created_at_not_null";--> statement-breakpoint
ALTER POLICY "composition_workspace_isolation" ON "write_up" RENAME TO "write_up_workspace_isolation";--> statement-breakpoint
ALTER TABLE "composition_include" RENAME TO "write_up_include";--> statement-breakpoint
ALTER TABLE "write_up_include" RENAME COLUMN "composition_id" TO "write_up_id";--> statement-breakpoint
ALTER TABLE "write_up_include" RENAME CONSTRAINT "composition_include_workspace_id_composition_id_id_pk" TO "write_up_include_workspace_id_write_up_id_id_pk";--> statement-breakpoint
ALTER TABLE "write_up_include" RENAME CONSTRAINT "composition_include_composition_fk" TO "write_up_include_write_up_fk";--> statement-breakpoint
ALTER TABLE "write_up_include" RENAME CONSTRAINT "composition_include_identity_fk" TO "write_up_include_identity_fk";--> statement-breakpoint
ALTER TABLE "write_up_include" RENAME CONSTRAINT "composition_include_ordinal_check" TO "write_up_include_ordinal_check";--> statement-breakpoint
ALTER TABLE "write_up_include" RENAME CONSTRAINT "composition_include_workspace_id_not_null" TO "write_up_include_workspace_id_not_null";--> statement-breakpoint
ALTER TABLE "write_up_include" RENAME CONSTRAINT "composition_include_composition_id_not_null" TO "write_up_include_write_up_id_not_null";--> statement-breakpoint
ALTER TABLE "write_up_include" RENAME CONSTRAINT "composition_include_id_not_null" TO "write_up_include_id_not_null";--> statement-breakpoint
ALTER TABLE "write_up_include" RENAME CONSTRAINT "composition_include_ordinal_not_null" TO "write_up_include_ordinal_not_null";--> statement-breakpoint
ALTER TABLE "write_up_include" RENAME CONSTRAINT "composition_include_iri_not_null" TO "write_up_include_iri_not_null";--> statement-breakpoint
ALTER INDEX "composition_include_workspace_id_iri_idx" RENAME TO "write_up_include_workspace_id_iri_idx";--> statement-breakpoint
ALTER POLICY "composition_include_workspace_isolation" ON "write_up_include" RENAME TO "write_up_include_workspace_isolation";--> statement-breakpoint
ALTER TABLE "concept_class_override" RENAME TO "concept_sensitivity_override";--> statement-breakpoint
ALTER TABLE "concept_sensitivity_override" RENAME CONSTRAINT "concept_class_override_workspace_id_iri_pk" TO "concept_sensitivity_override_workspace_id_iri_pk";--> statement-breakpoint
ALTER TABLE "concept_sensitivity_override" RENAME CONSTRAINT "concept_class_override_identity_fk" TO "concept_sensitivity_override_identity_fk";--> statement-breakpoint
ALTER TABLE "concept_sensitivity_override" RENAME CONSTRAINT "concept_class_override_sensitivity_check" TO "concept_sensitivity_override_sensitivity_check";--> statement-breakpoint
ALTER TABLE "concept_sensitivity_override" RENAME CONSTRAINT "concept_class_override_audience_check" TO "concept_sensitivity_override_audience_check";--> statement-breakpoint
ALTER TABLE "concept_sensitivity_override" RENAME CONSTRAINT "concept_class_override_actor_check" TO "concept_sensitivity_override_actor_check";--> statement-breakpoint
ALTER TABLE "concept_sensitivity_override" RENAME CONSTRAINT "concept_class_override_workspace_id_not_null" TO "concept_sensitivity_override_workspace_id_not_null";--> statement-breakpoint
ALTER TABLE "concept_sensitivity_override" RENAME CONSTRAINT "concept_class_override_iri_not_null" TO "concept_sensitivity_override_iri_not_null";--> statement-breakpoint
ALTER TABLE "concept_sensitivity_override" RENAME CONSTRAINT "concept_class_override_sensitivity_not_null" TO "concept_sensitivity_override_sensitivity_not_null";--> statement-breakpoint
ALTER TABLE "concept_sensitivity_override" RENAME CONSTRAINT "concept_class_override_audience_not_null" TO "concept_sensitivity_override_audience_not_null";--> statement-breakpoint
ALTER TABLE "concept_sensitivity_override" RENAME CONSTRAINT "concept_class_override_actor_not_null" TO "concept_sensitivity_override_actor_not_null";--> statement-breakpoint
ALTER TABLE "concept_sensitivity_override" RENAME CONSTRAINT "concept_class_override_audit_event_id_not_null" TO "concept_sensitivity_override_audit_event_id_not_null";--> statement-breakpoint
ALTER TABLE "concept_sensitivity_override" RENAME CONSTRAINT "concept_class_override_recorded_at_not_null" TO "concept_sensitivity_override_recorded_at_not_null";--> statement-breakpoint
ALTER POLICY "concept_class_override_workspace_isolation" ON "concept_sensitivity_override" RENAME TO "concept_sensitivity_override_workspace_isolation";--> statement-breakpoint
ALTER TABLE "source_document" RENAME COLUMN "quarantine_error" TO "unreadable_reason";--> statement-breakpoint
-- RENAME keeps its grants. The CHECK on source_document and index.readable_passage call it by its
-- oid, so both read the new name with no rebuild, and the view keeps security_invoker.
ALTER FUNCTION public.narrower_class(text, text) RENAME TO narrower_sensitivity;--> statement-breakpoint
-- Each CHECK naming an old value goes first so the value can be rewritten. Row-level security is
-- forced on every one of these tables and a migration runs as the owner, so the updates take each
-- row's workspace scope. A suggestion's kind is the proposer's and a trigger refuses any update to
-- it, so that trigger stands aside for this rewrite alone; the map's generation guard likewise, as
-- a relabelled row keeps whatever generation it had.
ALTER TABLE "suggestion" DROP CONSTRAINT "suggestion_kind_check";--> statement-breakpoint
ALTER TABLE "suggestion" DROP CONSTRAINT "suggestion_repair_proposer_check";--> statement-breakpoint
ALTER TABLE "concept_verification" DROP CONSTRAINT "concept_verification_origin_check";--> statement-breakpoint
ALTER TABLE "source_document" DROP CONSTRAINT "source_document_outcome_check";--> statement-breakpoint
ALTER TABLE "source_document" DROP CONSTRAINT "source_document_quarantine_error_check";--> statement-breakpoint
ALTER TABLE "map_node" DROP CONSTRAINT "map_node_label_check";--> statement-breakpoint
ALTER TABLE "suggestion" DISABLE TRIGGER "suggestion_decides_once_trigger";--> statement-breakpoint
ALTER TABLE "map_node" DISABLE TRIGGER "map_node_generation_guard";--> statement-breakpoint
DO $$
DECLARE
  scope text;
BEGIN
  FOR scope IN SELECT id FROM public.workspace LOOP
    PERFORM set_config('app.workspace_id', scope, true);
    UPDATE public.suggestion SET kind = 'suggested-concept' WHERE kind = 'candidate';
    UPDATE public.suggestion SET kind = 'citation-fix' WHERE kind = 'repair';
    UPDATE public.concept_verification SET origin = 'citation-fix' WHERE origin = 'repair';
    UPDATE public.source_document SET outcome = 'unreadable' WHERE outcome = 'quarantined';
    UPDATE public.map_node SET label = 'WriteUp' WHERE label = 'Composition';
  END LOOP;
  PERFORM set_config('app.workspace_id', '', true);
END $$;--> statement-breakpoint
ALTER TABLE "suggestion" ENABLE TRIGGER "suggestion_decides_once_trigger";--> statement-breakpoint
ALTER TABLE "map_node" ENABLE TRIGGER "map_node_generation_guard";--> statement-breakpoint
-- ADD CONSTRAINT validates every row standing, so no old value survives it.
ALTER TABLE "suggestion" ADD CONSTRAINT "suggestion_kind_check" CHECK (kind IN ('edit', 'suggested-concept', 'promotion', 'citation-fix'));--> statement-breakpoint
ALTER TABLE "suggestion" ADD CONSTRAINT "suggestion_citation_fix_proposer_check" CHECK (kind <> 'citation-fix' OR proposer LIKE 'process:better-answers-%');--> statement-breakpoint
ALTER TABLE "concept_verification" ADD CONSTRAINT "concept_verification_origin_check" CHECK (origin IN ('platform', 'imported', 'erasure-rewrite', 'citation-fix'));--> statement-breakpoint
ALTER TABLE "source_document" ADD CONSTRAINT "source_document_outcome_check" CHECK (outcome IS NULL OR outcome IN ('converted', 'unreadable'));--> statement-breakpoint
ALTER TABLE "source_document" ADD CONSTRAINT "source_document_unreadable_reason_check" CHECK (unreadable_reason IS NULL OR outcome IS NOT DISTINCT FROM 'unreadable');--> statement-breakpoint
ALTER TABLE "map_node" ADD CONSTRAINT "map_node_label_check" CHECK ((gen IS NOT NULL AND label IN ('Concept', 'Section', 'Source', 'Actor', 'WriteUp', 'Evidence', 'CanonicalEntity')) OR (gen IS NULL AND label LIKE 'source-entity:%'));--> statement-breakpoint
-- The kinds each tier may raise are held in the function's own body, so it is replaced with its
-- security settings restated; CREATE OR REPLACE keeps its grants.
CREATE OR REPLACE FUNCTION public.submit_suggestion_set(
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
  -- the row's CHECK accepts — and put a change in a person's name into the suggestions an
  -- Admin decides from, and a compromised app could raise a run's *suggested concept*
  -- nobody ran.
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
  -- (`suggestion_proposer_check`, `suggestion_citation_fix_proposer_check`): held where a
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
-- Every pending migration runs in one transaction, so the bound ends with this one.
SET LOCAL lock_timeout = DEFAULT;
