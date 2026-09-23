-- Custom migration (hand-written SQL; ADR 0032).
-- The CHECK reads two of the columns, so it goes first or the DROP COLUMN fails on it.
ALTER TABLE "index".chunk DROP CONSTRAINT "chunk_audience_check";--> statement-breakpoint
-- Catalogue-only at a million rows, and no backfill: nothing a reader consults was copied
-- onto the row, so there is nothing to make consistent.
ALTER TABLE "index".chunk
  DROP COLUMN "published_at",
  DROP COLUMN "sensitivity",
  DROP COLUMN "audience",
  DROP COLUMN "audience_groups";
