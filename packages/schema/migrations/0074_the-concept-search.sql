-- Custom migration (hand-written SQL; ADR 0032).
-- Bounded wait for the lock the column's table rewrite takes (ADR 0007).
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "concept_index" ADD CONSTRAINT "concept_index_iri_check" CHECK (iri ~ '^https:\/\/better-answers\.com\/c\/[0-9A-HJKMNP-TV-Z]{26}$');--> statement-breakpoint
ALTER TABLE "concept_index" ADD COLUMN "search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', jsonb_path_query_array(frontmatter, '$.tags[*]')), 'B') || setweight(to_tsvector('english', coalesce(substring(body from '(?n)^Also known as: (.*)$'), '')), 'B') || setweight(to_tsvector('english', body), 'C')) STORED NOT NULL;--> statement-breakpoint
CREATE INDEX "concept_index_search_gin" ON "concept_index" USING gin ("search");--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
