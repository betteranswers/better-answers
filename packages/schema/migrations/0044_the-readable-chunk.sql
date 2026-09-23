-- Custom migration (hand-written SQL; ADR 0032).
-- The one SQL statement of the class ranking, and the view that reads a chunk's visibility
-- from the two rows it already depends on (ADR 0044).
--
-- Hand-written rather than generated because `drizzle-kit generate` writes the DDL its schema
-- file reaches, and a function, a view and a privilege are none of them a column — as
-- migrations 0002, 0020, 0022, 0037, 0042 and 0043 each are.
--
-- **Additive.** `index.chunk` keeps `published_at`, `sensitivity`, `audience`,
-- `audience_groups` and `chunk_audience_check`; both tiers keep writing them; no reading
-- statement in either tier names the view. The readers move in the change after this one, so
-- each piece of the build merges alone and this one is judged on the view's answer.
--
-- **The ranking, said once.** The narrower of a binding's class and its document's own was
-- written four ways over three independent statements of *Restricted* → *Internal* →
-- *Public*, and ADR 0044's whole argument is that the fold belongs where the read happens.
-- `narrower_class` is that ranking as a single array, and every later caller — the view here,
-- `reconcile_catalogue` when the worker's fold goes — reads the order from this one place.
--
-- A word outside the set answers NULL rather than guessing, which makes the predicate's class
-- arm NULL and the row unreadable: the closed direction. Both source columns carry the class
-- CHECK, so nothing in the estate can reach that arm; it is what the function does when
-- something one day does.
--
-- The search path is pinned and `array_position` is schema-qualified, so no `pg_temp` object a
-- caller has made can shadow what the fold counts with. The cost of the pin is that the
-- planner will not inline a SQL function carrying a SET clause: the CASE the spike measured
-- folded into the plan, and this one stays a call. It is a call per row of the join's output,
-- which the spike's plans show is the small set the index scan already produced — the fold
-- never drives a scan — so the read stays inside ADR 0037's budget either way. Migration
-- 0002's `llm_route_for` takes the other side of the same trade, schema-qualifying without the
-- pin to keep a STABLE function inlinable.
CREATE FUNCTION public.narrower_class(a text, b text) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE
           WHEN rank_a IS NULL THEN NULL
           WHEN b IS NULL THEN a
           WHEN rank_b IS NULL THEN NULL
           WHEN rank_b < rank_a THEN b
           ELSE a
         END
    FROM (SELECT pg_catalog.array_position(ranking, a) AS rank_a,
                 pg_catalog.array_position(ranking, b) AS rank_b
            FROM (SELECT ARRAY['Restricted', 'Internal', 'Public']::text[] AS ranking)
                 AS narrowest_first
         ) AS ranked
$$;
--> statement-breakpoint
-- A null `proacl` is EXECUTE to PUBLIC, so the revoke is what makes the grant mean anything;
-- migration 0043 wrote that pattern out for the five functions that had gone without it.
-- `worker_rt` is named because the run's fold into `source_document.sensitivity` becomes this
-- call, and `app_rt` because the view's own `sensitivity` is this call under SECURITY INVOKER.
REVOKE EXECUTE ON FUNCTION public.narrower_class(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.narrower_class(text, text) TO app_rt, worker_rt;
--> statement-breakpoint
-- **The view.** `security_invoker` so the base tables' policies and the caller's own
-- privileges decide, not the view owner's — without it a view owned by the migrator would read
-- every tenant's rows for anybody who could select it. `security_barrier` is deliberately not
-- set: nothing needs it, and it would stop the planner reordering through the view and lose
-- the GIN scan the spike measured.
--
-- Both joins carry `workspace_id` beside the id. The chunk table is partitioned by that
-- column, so the condition is what prunes the read to one tenant's partition; a join on the id
-- alone would plan across every partition and leave the isolation to the policy alone.
--
-- The binding join is INNER and that is the closed direction: a chunk whose binding row has
-- gone is unreadable, so no withdrawal act, now or later, has to remember the chunks. The
-- document join is LEFT, which keeps the old subquery's reading — a row whose document has
-- gone is still its binding's — and is why `narrower_class` takes the first argument where the
-- second is NULL.
CREATE VIEW "index".readable_chunk WITH (security_invoker = true) AS
  SELECT c.id,
         c.workspace_id,
         c.content,
         c.embedding,
         c.embedding_route_id,
         c.binding_id,
         c.source_document_id,
         c.locator,
         c.ordinal,
         c.char_start,
         c.char_end,
         c.search,
         b.published_at,
         b.audience,
         b.audience_groups,
         public.narrower_class(b.sensitivity, d.sensitivity) AS sensitivity
    FROM "index".chunk AS c
    JOIN public.source_binding AS b
      ON b.workspace_id = c.workspace_id AND b.id = c.binding_id
    LEFT JOIN public.source_document AS d
      ON d.workspace_id = c.workspace_id AND d.id = c.source_document_id;
--> statement-breakpoint
-- Migration 0000's default privileges in `index` hand `app_rt` four verbs on every relation a
-- later migration creates there, and a view is a relation `ON TABLES` reaches — so a view
-- created and left alone arrives holding INSERT, UPDATE and DELETE nobody meant it to have.
--
-- `worker_rt` needs no line: migration 0043 revoked its default in this schema, and from there
-- the GRANT lines are the whole statement of the worker's reach. No described worker behaviour
-- reads under the predicate (ADR 0031), so it has none here and is refused the view.
REVOKE ALL PRIVILEGES ON "index".readable_chunk FROM app_rt;
--> statement-breakpoint
GRANT SELECT ON "index".readable_chunk TO app_rt;
