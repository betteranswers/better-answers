-- Custom migration (hand-written SQL; ADR 0032).
-- A workspace's slug becomes its short name: the column, its unique constraint (whose index the
-- rename carries), and the NOT NULL constraint PostgreSQL 18 names after the column. No function,
-- view, policy or trigger names the column. A rename takes an ACCESS EXCLUSIVE lock; five seconds
-- bounds the wait behind a reader, and a failed release is re-run by hand.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "workspace" RENAME COLUMN "slug" TO "short_name";--> statement-breakpoint
ALTER TABLE "workspace" RENAME CONSTRAINT "workspace_slug_unique" TO "workspace_short_name_unique";--> statement-breakpoint
ALTER TABLE "workspace" RENAME CONSTRAINT "workspace_slug_not_null" TO "workspace_short_name_not_null";--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
