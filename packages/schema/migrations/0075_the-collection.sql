-- Custom migration (hand-written SQL; ADR 0032).
-- Bounded wait for the lock the column's table rewrite takes (ADR 0007).
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "concept_index" ADD COLUMN "collection" text GENERATED ALWAYS AS (substring(path from '^knowledge/([^/]+)/')) STORED;--> statement-breakpoint
CREATE INDEX "concept_index_workspace_id_collection_idx" ON "concept_index" USING btree ("workspace_id","collection");--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
