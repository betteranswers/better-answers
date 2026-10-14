-- Custom migration (hand-written SQL; ADR 0032).
-- drizzle-kit drops and re-adds a generated column, which drops its GIN index with it. SET EXPRESSION
-- rewrites the table and rebuilds the index in place.
-- Bounded wait for the lock the expression's table rewrite takes (ADR 0007).
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "concept_index" ALTER COLUMN "search" SET EXPRESSION AS (setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', jsonb_path_query_array(frontmatter, '$.tags[*]')), 'B') || setweight(to_tsvector('english', jsonb_path_query_array(frontmatter, '$.description')), 'B') || setweight(to_tsvector('english', coalesce(substring(body from '(?n)^Also known as: (.*)$'), '')), 'B') || setweight(to_tsvector('english', body), 'C'));--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
