-- Custom migration (hand-written SQL; ADR 0032).
-- A word outside the set answers NULL rather than guessing, which makes the predicate's class
-- arm NULL and the row unreadable: the closed direction.
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
$$;--> statement-breakpoint
-- A null `proacl` is EXECUTE to PUBLIC, so the revoke is what makes the grant mean anything.
REVOKE EXECUTE ON FUNCTION public.narrower_class(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.narrower_class(text, text) TO app_rt, worker_rt;--> statement-breakpoint
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
      ON d.workspace_id = c.workspace_id AND d.id = c.source_document_id;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON "index".readable_chunk FROM app_rt;--> statement-breakpoint
GRANT SELECT ON "index".readable_chunk TO app_rt;
